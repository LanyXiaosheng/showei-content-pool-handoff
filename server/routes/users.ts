import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from '../db';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { parsePagination, pageMeta } from '../lib/validation';
import { requireRole, requireUser } from '../lib/http';
import { createUser, getTeam, listUsers, resetUserPassword, updateUser } from '../services/users';
import { writeAudit } from '../services/audit';
import type { Role } from '../types';

const roleSchema = z.enum(['ADMIN', 'AGENT', 'USER']);
const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  displayName: z.string().trim().min(2).max(40),
  role: z.enum(['AGENT', 'USER']),
  password: z.string().min(10).max(128).regex(/[A-Za-z]/).regex(/\d/).optional(),
  inviteEnabled: z.boolean().optional(),
});
const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  inviteEnabled: z.boolean().optional(),
  displayName: z.string().trim().min(2).max(40).optional(),
});
const resetSchema = z.object({
  newPassword: z.string().min(10).max(128).regex(/[A-Za-z]/).regex(/\d/),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/users', async (request) => {
    requireRole(request, 'ADMIN');
    const query = request.query as Record<string, string | undefined>;
    const page = parsePagination(query);
    const role = query.role && roleSchema.safeParse(query.role).success ? (query.role as Role) : undefined;
    const { rows, total } = await listUsers({
      role,
      status: query.status === 'ACTIVE' || query.status === 'DISABLED' ? query.status : undefined,
      q: query.q?.slice(0, 80),
      page: page.page,
      pageSize: page.pageSize,
      offset: page.offset,
    });
    return { data: { items: rows, pagination: pageMeta(total, page.page, page.pageSize) } };
  });

  app.post('/admin/users', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const input = createSchema.parse(request.body);
    const created = await createUser(actor, input);
    return {
      data: {
        user: {
          id: created.id,
          email: created.email,
          displayName: created.display_name,
          role: created.role,
          status: created.status,
          inviteEnabled: created.invite_enabled,
        },
        temporaryPassword: created.temporaryPassword ?? null,
      },
      message: created.temporaryPassword
        ? '账号已创建，请立即把临时密码发给对方（仅展示一次）'
        : '账号已创建',
    };
  });

  app.patch('/admin/users/:id', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateSchema.parse(request.body);
    await updateUser(actor, id, input);
    return { data: { ok: true }, message: '账号设置已更新' };
  });

  app.post('/admin/users/:id/reset-password', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = resetSchema.parse(request.body);
    await resetUserPassword(actor, id, input.newPassword);
    return { data: { ok: true }, message: '密码已重置，该用户所有会话已退出' };
  });

  app.get('/team/users', async (request) => {
    const actor = requireUser(request);
    if (actor.role !== 'AGENT') throw forbidden('仅代理可查看团队成员');
    const query = parsePagination(request.query);
    const rows = await getTeam(actor.id);
    const total = rows.length;
    const paged = rows.slice(query.offset, query.offset + query.pageSize);
    return { data: { items: paged, pagination: pageMeta(total, query.page, query.pageSize) } };
  });

  app.get('/team/overview', async (request) => {
    const actor = requireRole(request, 'AGENT');
    const stats = await one<{
      downline: string;
      active_downline: string;
      pending_tasks: string;
      completed_tasks: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM users WHERE invited_by = $1 AND role = 'USER') AS downline,
         (SELECT count(*)::text FROM users WHERE invited_by = $1 AND role = 'USER' AND status = 'ACTIVE') AS active_downline,
         (SELECT count(*)::text FROM tasks t JOIN users u ON u.id = t.submitter_id
            WHERE u.invited_by = $1 AND t.status = 'PENDING_REVIEW') AS pending_tasks,
         (SELECT count(*)::text FROM tasks t JOIN users u ON u.id = t.submitter_id
            WHERE u.invited_by = $1 AND t.status = 'COMPLETED') AS completed_tasks`,
      [actor.id],
    );
    return {
      data: {
        downline: Number(stats?.downline ?? 0),
        activeDownline: Number(stats?.active_downline ?? 0),
        pendingTasks: Number(stats?.pending_tasks ?? 0),
        completedTasks: Number(stats?.completed_tasks ?? 0),
        inviteEnabled: actor.inviteEnabled,
      },
    };
  });
}
