import crypto from 'node:crypto';
import { one, q, withTx } from '../db';
import { conflict, notFound } from '../lib/errors';
import { hashPassword } from '../lib/crypto';
import type { AuthUser, Role } from '../types';
import { createNotification, writeAudit } from './audit';
import { revokeAllSessions } from './session';

export async function listUsers(filters: {
  role?: Role;
  status?: string;
  q?: string;
  invitedBy?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.role) {
    params.push(filters.role);
    where.push(`u.role = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`u.status = $${params.length}`);
  }
  if (filters.invitedBy) {
    params.push(filters.invitedBy);
    where.push(`u.invited_by = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ count: string }>(`SELECT count(*)::text AS count FROM users u ${whereSql}`, params);
  params.push(filters.pageSize, filters.offset);
  const rows = await q(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.invite_enabled,
            u.invited_by, u.created_at, u.last_login_at,
            inviter.display_name AS inviter_name,
            (SELECT count(*)::int FROM tasks t WHERE t.submitter_id = u.id) AS task_count,
            (SELECT count(*)::int FROM users d WHERE d.invited_by = u.id AND d.role = 'USER') AS downline_count
     FROM users u
     LEFT JOIN users inviter ON inviter.id = u.invited_by
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows, total: Number(total?.count ?? 0) };
}

export async function createUser(actor: AuthUser, input: {
  email: string;
  displayName: string;
  role: Role;
  password?: string;
  inviteEnabled?: boolean;
}) {
  if (actor.role !== 'ADMIN') throw new Error('only admin');
  const password = input.password || `Shiwei-${crypto.randomBytes(5).toString('hex')}-${crypto.randomInt(10, 99)}`;
  const passwordHash = await hashPassword(password);
  try {
    const user = await withTx(async (client) => {
      const inserted = await client.query(
        `INSERT INTO users (email, password_hash, display_name, role, invite_enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, email, display_name, role, status, invite_enabled, created_at`,
        [input.email, passwordHash, input.displayName, input.role, input.role === 'AGENT' ? Boolean(input.inviteEnabled) : false, actor.id],
      );
      const created = inserted.rows[0];
      await createNotification(
        client,
        created.id,
        'WELCOME',
        '账号已创建',
        input.role === 'AGENT' ? '管理员已为你开通代理账号，邀请权限以管理员设置为准。' : '管理员已为你开通账号，可开始浏览内容池或提交素材任务。',
      );
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'USER_CREATED_BY_ADMIN',
          targetType: 'user',
          targetId: created.id,
          meta: { role: input.role, inviteEnabled: input.inviteEnabled ?? false },
        },
        client,
      );
      return created;
    });
    return { ...user, temporaryPassword: input.password ? undefined : password };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw conflict('该邮箱已存在', 'EMAIL_EXISTS');
    throw error;
  }
}

export async function updateUser(actor: AuthUser, userId: string, input: {
  status?: 'ACTIVE' | 'DISABLED';
  inviteEnabled?: boolean;
  displayName?: string;
}) {
  const target = await one<{
    id: string; role: Role; status: string; invite_enabled: boolean; display_name: string;
  }>('SELECT id, role, status, invite_enabled, display_name FROM users WHERE id = $1', [userId]);
  if (!target) throw notFound('用户不存在');
  if (target.role === 'ADMIN' && target.id !== actor.id) {
    throw conflict('不能修改其他管理员账号', 'ADMIN_PROTECTED');
  }
  if (target.id === actor.id && input.status === 'DISABLED') {
    throw conflict('不能停用自己的账号', 'SELF_DISABLE');
  }
  if (target.role !== 'AGENT' && input.inviteEnabled !== undefined) {
    throw conflict('只有代理账号拥有邀请开关', 'INVITE_NOT_APPLICABLE');
  }
  if (target.role === 'ADMIN' && input.status === 'DISABLED') {
    throw conflict('管理员账号不能停用', 'ADMIN_PROTECTED');
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.status !== undefined) {
    params.push(input.status);
    fields.push(`status = $${params.length}`);
  }
  if (input.inviteEnabled !== undefined) {
    params.push(input.inviteEnabled);
    fields.push(`invite_enabled = $${params.length}`);
  }
  if (input.displayName !== undefined) {
    params.push(input.displayName);
    fields.push(`display_name = $${params.length}`);
  }
  if (!fields.length) return target;
  params.push(userId);
  await q(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
  if (input.status === 'DISABLED') await revokeAllSessions(userId);
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'USER_UPDATED',
    targetType: 'user',
    targetId: userId,
    meta: input,
  });
}

export async function resetUserPassword(actor: AuthUser, userId: string, newPassword: string) {
  const target = await one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (!target) throw notFound('用户不存在');
  if (target.role === 'ADMIN' && target.id !== actor.id) throw conflict('不能重置其他管理员密码', 'ADMIN_PROTECTED');
  const passwordHash = await hashPassword(newPassword);
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
  await revokeAllSessions(userId);
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PASSWORD_RESET_BY_ADMIN',
    targetType: 'user',
    targetId: userId,
  });
}

export async function getTeam(agentId: string) {
  const rows = await q(
    `SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at,
            count(t.id)::int AS task_count,
            count(t.id) FILTER (WHERE t.status = 'PENDING_REVIEW')::int AS pending_count,
            count(t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS completed_count,
            max(t.created_at) AS last_task_at
     FROM users u
     LEFT JOIN tasks t ON t.submitter_id = u.id
     WHERE u.invited_by = $1 AND u.role = 'USER'
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    [agentId],
  );
  return rows.rows;
}
