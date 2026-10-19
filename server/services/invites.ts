import { one, q, withTx } from '../db';
import { config } from '../config';
import { conflict, forbidden, notFound } from '../lib/errors';
import { randomInviteCode } from '../lib/crypto';
import type { AuthUser, Role } from '../types';
import { writeAudit, createNotification } from './audit';
import { hashPassword } from '../lib/crypto';

interface InviteJoinRow {
  id: string;
  code: string;
  role: Role;
  created_by: string;
  inviter_name: string;
  inviter_role: Role;
  inviter_status: 'ACTIVE' | 'DISABLED';
  inviter_invite_enabled: boolean;
  expires_at: Date;
  max_uses: number;
  used_count: number;
  revoked_at: Date | null;
  note: string | null;
  last_used_at: Date | null;
  created_at: Date;
}

export interface CreateInviteInput {
  role: Role;
  expiresInDays: number;
  maxUses: number;
  note?: string;
}

export function inviteStatus(invite: { revoked_at: Date | null; expires_at: Date; used_count: number; max_uses: number }) {
  if (invite.revoked_at) return 'REVOKED';
  if (new Date(invite.expires_at).getTime() <= Date.now()) return 'EXPIRED';
  if (invite.used_count >= invite.max_uses) return 'USED';
  return 'ACTIVE';
}

export async function createInvite(actor: AuthUser, input: CreateInviteInput) {
  if (actor.role === 'USER') throw forbidden('普通用户没有邀请权限');
  if (actor.role === 'AGENT') {
    if (!actor.inviteEnabled) throw forbidden('管理员已关闭你的邀请权限');
    if (input.role !== 'USER') throw forbidden('代理只能邀请普通用户');
  }
  if (actor.role === 'ADMIN' && !['AGENT', 'USER'].includes(input.role)) {
    throw forbidden('邀请角色不合法');
  }

  const daily = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM invites WHERE created_by = $1 AND created_at > now() - interval '24 hours'`,
    [actor.id],
  );
  if (Number(daily?.count ?? 0) >= 30) {
    throw conflict('24 小时内创建的邀请码已达上限', 'INVITE_RATE_LIMIT');
  }

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = randomInviteCode(10);
    const exists = await one('SELECT 1 FROM invites WHERE code = $1', [code]);
    if (!exists) break;
  }

  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  const invite = await one<InviteJoinRow>(
    `INSERT INTO invites (code, role, created_by, expires_at, max_uses, note)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, code, role, created_by, expires_at, max_uses, used_count, revoked_at, note, last_used_at, created_at,
       (SELECT display_name FROM users WHERE id = $3) AS inviter_name,
       $7::text AS inviter_role, 'ACTIVE'::text AS inviter_status, true AS inviter_invite_enabled`,
    [code, input.role, actor.id, expiresAt, input.maxUses, input.note?.slice(0, 200) ?? null, actor.role],
  );
  if (!invite) throw new Error('邀请码创建失败');

  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'INVITE_CREATED',
    targetType: 'invite',
    targetId: invite.id,
    meta: { role: input.role, expiresAt, maxUses: input.maxUses },
  });

  return { ...serializeInvite(invite), url: `${config.publicOrigin}/register?code=${encodeURIComponent(code)}` };
}

export async function listInvites(actor: AuthUser, filters: { status?: string; page: number; pageSize: number; offset: number }) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (actor.role === 'AGENT') {
    params.push(actor.id);
    conditions.push(`i.created_by = $${params.length}`);
  } else if (actor.role !== 'ADMIN') {
    throw forbidden();
  }
  if (filters.status === 'ACTIVE') {
    conditions.push(`i.revoked_at IS NULL AND i.expires_at > now() AND i.used_count < i.max_uses`);
  } else if (filters.status === 'REVOKED') {
    conditions.push('i.revoked_at IS NOT NULL');
  } else if (filters.status === 'EXPIRED') {
    conditions.push(`i.revoked_at IS NULL AND i.expires_at <= now()`);
  } else if (filters.status === 'USED') {
    conditions.push('i.used_count >= i.max_uses');
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM invites i ${where}`,
    params,
  );
  params.push(filters.pageSize, filters.offset);
  const rows = await q<InviteJoinRow>(
    `SELECT i.*, u.display_name AS inviter_name, u.role AS inviter_role,
            u.status AS inviter_status, u.invite_enabled AS inviter_invite_enabled
     FROM invites i JOIN users u ON u.id = i.created_by
     ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map(serializeInvite),
    total: Number(totalRow?.count ?? 0),
  };
}

function serializeInvite(row: InviteJoinRow) {
  return {
    id: row.id,
    code: row.code,
    role: row.role,
    inviterId: row.created_by,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    revokedAt: row.revoked_at,
    note: row.note,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    status: inviteStatus(row),
    url: `${config.publicOrigin}/register?code=${encodeURIComponent(row.code)}`,
  };
}

export async function revokeInvite(actor: AuthUser, inviteId: string) {
  const invite = await one<{ id: string; created_by: string; revoked_at: Date | null }>(
    'SELECT id, created_by, revoked_at FROM invites WHERE id = $1',
    [inviteId],
  );
  if (!invite) throw notFound('邀请码不存在');
  if (actor.role !== 'ADMIN' && invite.created_by !== actor.id) throw forbidden();
  if (invite.revoked_at) return;
  await q('UPDATE invites SET revoked_at = now() WHERE id = $1', [inviteId]);
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'INVITE_REVOKED',
    targetType: 'invite',
    targetId: inviteId,
  });
}

export async function checkInvite(code: string) {
  const row = await one<InviteJoinRow>(
    `SELECT i.*, u.display_name AS inviter_name, u.role AS inviter_role,
            u.status AS inviter_status, u.invite_enabled AS inviter_invite_enabled
     FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.code = $1`,
    [code.toUpperCase()],
  );
  if (!row) return { valid: false, reason: '邀请码不存在' };
  if (row.revoked_at) return { valid: false, reason: '邀请码已被撤销' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { valid: false, reason: '邀请码已过期' };
  if (row.used_count >= row.max_uses) return { valid: false, reason: '邀请码已被用完' };
  if (row.inviter_status !== 'ACTIVE') return { valid: false, reason: '邀请人账号已停用' };
  if (row.inviter_role === 'AGENT' && !row.inviter_invite_enabled) {
    return { valid: false, reason: '邀请人的邀请权限已被管理员暂停' };
  }
  return {
    valid: true,
    role: row.role,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
    remainingUses: row.max_uses - row.used_count,
  };
}

export interface RegisterInput {
  code: string;
  email: string;
  displayName: string;
  password: string;
  ip: string;
}

export async function registerWithInvite(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);
  const result = await withTx(async (client) => {
    const inviteResult = await client.query<InviteJoinRow>(
      `SELECT i.*, u.display_name AS inviter_name, u.role AS inviter_role,
              u.status AS inviter_status, u.invite_enabled AS inviter_invite_enabled
       FROM invites i JOIN users u ON u.id = i.created_by
       WHERE i.code = $1
       FOR UPDATE OF i`,
      [input.code.toUpperCase()],
    );
    const invite = inviteResult.rows[0];
    if (!invite) throw notFound('邀请码不存在');
    if (invite.revoked_at) throw conflict('邀请码已被撤销', 'INVITE_REVOKED');
    if (new Date(invite.expires_at).getTime() <= Date.now()) throw conflict('邀请码已过期', 'INVITE_EXPIRED');
    if (invite.used_count >= invite.max_uses) throw conflict('邀请码已被用完', 'INVITE_USED');
    if (invite.inviter_status !== 'ACTIVE') throw conflict('邀请人账号已停用', 'INVITER_DISABLED');
    if (invite.inviter_role === 'AGENT' && !invite.inviter_invite_enabled) {
      throw conflict('邀请人的邀请权限已被管理员暂停', 'INVITER_INVITE_DISABLED');
    }

    let user;
    try {
      const inserted = await client.query<{ id: string; email: string; display_name: string; role: Role }>(
        `INSERT INTO users (email, password_hash, display_name, role, invited_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, email, display_name, role`,
        [input.email, passwordHash, input.displayName, invite.role, invite.created_by],
      );
      user = inserted.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw conflict('该邮箱已注册', 'EMAIL_EXISTS');
      }
      throw error;
    }

    await client.query(
      `UPDATE invites SET used_count = used_count + 1, last_used_at = now() WHERE id = $1`,
      [invite.id],
    );
    await client.query(
      `INSERT INTO invite_redemptions (invite_id, user_id, email) VALUES ($1,$2,$3)`,
      [invite.id, user.id, input.email],
    );
    await createNotification(
      client,
      user.id,
      'WELCOME',
      '欢迎来到拾味内容中台',
      invite.role === 'AGENT'
        ? '你的代理账号已开通。邀请权限由管理员单独开启；你可以先提交素材任务。'
        : '账号已开通。你可以在内容池领取素材，也可以提交自己的素材任务等待审核。',
    );
    await writeAudit(
      {
        actorId: user.id,
        actorRole: invite.role,
        action: 'USER_REGISTERED',
        targetType: 'user',
        targetId: user.id,
        meta: { inviteId: invite.id, invitedBy: invite.created_by },
        ip: input.ip,
      },
      client,
    );
    return { user, role: invite.role };
  });
  return result;
}
