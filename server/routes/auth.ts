import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { one, q } from '../db';
import { verifyPassword } from '../lib/crypto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { setSessionCookie, clearSessionCookie, clientIp } from '../lib/http';
import { createNotification, writeAudit } from '../services/audit';
import { createInvite, registerWithInvite } from '../services/invites';
import {
  createSession,
  destroyCurrentSession,
  isStrongEnoughPassword,
  publicUser,
  revokeAllSessions,
} from '../services/session';
import type { AuthUser, Role, UserRow } from '../types';

const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确').max(160);
const passwordSchema = z.string().min(10, '密码至少 10 位').max(128).regex(/[A-Za-z]/, '密码需包含字母').regex(/\d/, '密码需包含数字');
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const registerSchema = z.object({
  code: z.string().trim().min(6).max(24),
  email: emailSchema,
  displayName: z.string().trim().min(2, '昵称至少 2 个字').max(40),
  password: passwordSchema,
});
const inviteSelfSchema = z.object({
  role: z.enum(['AGENT', 'USER']).default('USER'),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
  maxUses: z.coerce.number().int().min(1).max(20).default(1),
  note: z.string().trim().max(200).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string' }, password: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);
    if (!user || !(await verifyPassword(user.password_hash, input.password))) {
      await writeAudit({
        actorId: user?.id ?? null,
        actorRole: user?.role ?? null,
        action: 'LOGIN_FAILED',
        targetType: 'user',
        targetId: user?.id,
        ip: clientIp(request),
      });
      throw unauthorized('邮箱或密码不正确');
    }
    if (user.status !== 'ACTIVE') throw forbidden('该账号已被停用，请联系管理员');
    await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const { token } = await createSession(user.id, clientIp(request), request.headers['user-agent']);
    setSessionCookie(reply, token, config.sessionTtlMs);
    await writeAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'LOGIN_SUCCEEDED',
      targetType: 'user',
      targetId: user.id,
      ip: clientIp(request),
    });
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          inviteEnabled: user.invite_enabled,
          status: user.status,
        },
      },
    };
  });

  app.post('/auth/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { user, role } = await registerWithInvite({
      code: input.code,
      email: input.email,
      displayName: input.displayName,
      password: input.password,
      ip: clientIp(request),
    });
    const { token } = await createSession(user.id, clientIp(request), request.headers['user-agent']);
    setSessionCookie(reply, token, config.sessionTtlMs);
    return {
      data: {
        user: { id: user.id, email: user.email, displayName: user.display_name, role, inviteEnabled: false },
      },
      message: '注册成功',
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    await destroyCurrentSession(request);
    clearSessionCookie(reply);
    return { data: { ok: true } };
  });

  app.get('/auth/me', async (request) => {
    const user = request.authUser as AuthUser;
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          inviteEnabled: user.inviteEnabled,
          status: user.status,
        },
      },
    };
  });

  app.post('/auth/demo-login', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!config.demoMode) throw forbidden('演示模式未开启');
    const input = z.object({ role: z.enum(['ADMIN', 'AGENT', 'USER']) }).parse(request.body);
    const email = input.role === 'ADMIN' ? config.adminEmail : input.role === 'AGENT' ? 'agent@shiwei.local' : 'user-a@shiwei.local';
    const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) throw unauthorized('演示账号尚未初始化，请先执行 pnpm db:seed');
    const { token } = await createSession(user.id, clientIp(request), request.headers['user-agent']);
    setSessionCookie(reply, token, config.sessionTtlMs);
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          inviteEnabled: user.invite_enabled,
        },
      },
    };
  });

  // 修改自己的密码：验证旧密码并注销其它会话。
  app.post('/auth/change-password', async (request, reply) => {
    const user = request.authUser as AuthUser;
    const input = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
    }).parse(request.body);
    const row = await one<UserRow>('SELECT * FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(row.password_hash, input.currentPassword))) {
      throw unauthorized('当前密码不正确');
    }
    const { hashPassword } = await import('../lib/crypto');
    await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(input.newPassword), user.id]);
    await revokeAllSessions(user.id);
    const { token } = await createSession(user.id, clientIp(request), request.headers['user-agent']);
    setSessionCookie(reply, token, config.sessionTtlMs);
    return { data: { ok: true }, message: '密码已更新' };
  });

  // 普通用户永远不能生成邀请码；代理不能邀请代理；代理邀请开关实时生效。
  app.post('/invites', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = request.authUser as AuthUser;
    if (!user) throw unauthorized();
    const input = inviteSelfSchema.parse(request.body ?? {});
    const invite = await createInvite(user, input);
    return { data: invite, message: '邀请码已生成' };
  });

  // 管理员可直接创建账号；此接口放在 admin 路由中，避免与邀请逻辑混淆。
  return;
}
