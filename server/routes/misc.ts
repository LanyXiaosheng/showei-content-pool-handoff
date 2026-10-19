import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db';
import { requireRole, requireUser } from '../lib/http';
import { pageMeta, parsePagination } from '../lib/validation';
import { getDashboard } from '../services/dashboard';
import { publicUser } from '../services/session';

export async function miscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/public/hero-image', async (_request, reply) => {
    const file = path.resolve(process.cwd(), 'fixtures/sample-dish.jpg');
    if (!fs.existsSync(file)) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Hero image missing' } };
    }
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.type('image/jpeg');
    return reply.send(fs.createReadStream(file));
  });

  app.get('/public/config', async () => {
    const { config } = await import('../config');
    return { data: { appName: '拾味内容中台', demoMode: config.demoMode } };
  });

  app.get('/dashboard', async (request) => {
    const actor = requireUser(request);
    return { data: await getDashboard(actor) };
  });

  app.get('/notifications', async (request) => {
    const actor = requireUser(request);
    const raw = request.query as { limit?: string; unread?: string };
    const limit = Math.min(50, Math.max(1, Number(raw.limit ?? 20) || 20));
    const condition = raw.unread === '1' ? 'AND read_at IS NULL' : '';
    const rows = await q(
      `SELECT id, kind, title, body, task_id, read_at, created_at
       FROM notifications WHERE user_id = $1 ${condition}
       ORDER BY created_at DESC LIMIT $2`,
      [actor.id, limit],
    );
    const unread = await one<{ count: string }>(
      'SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [actor.id],
    );
    return {
      data: {
        items: rows.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          taskId: row.task_id,
          readAt: row.read_at,
          createdAt: row.created_at,
        })),
        unreadCount: Number(unread?.count ?? 0),
      },
    };
  });

  app.post('/notifications/:id/read', async (request) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await q('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [id, actor.id]);
    return { data: { ok: true } };
  });

  app.post('/notifications/read-all', async (request) => {
    const actor = requireUser(request);
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [actor.id]);
    return { data: { ok: true } };
  });

  app.get('/admin/logs/generation', async (request) => {
    requireRole(request, 'ADMIN');
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const params: unknown[] = [];
    const conditions: string[] = ['TRUE'];
    if (raw.level && ['INFO', 'WARN', 'ERROR'].includes(raw.level)) {
      params.push(raw.level);
      conditions.push(`gl.level = $${params.length}`);
    }
    if (raw.q) {
      params.push(`%${raw.q}%`);
      conditions.push(`(t.task_no ILIKE $${params.length} OR gl.message ILIKE $${params.length} OR gl.event ILIKE $${params.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const total = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM generation_logs gl JOIN tasks t ON t.id = gl.task_id ${where}`,
      params,
    );
    params.push(page.pageSize, page.offset);
    const rows = await q(
      `SELECT gl.id, gl.level, gl.event, gl.message, gl.meta, gl.created_at,
              t.task_no, t.id AS task_id
       FROM generation_logs gl JOIN tasks t ON t.id = gl.task_id
       ${where} ORDER BY gl.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      data: {
        items: rows.rows.map((row) => ({
          id: String(row.id),
          level: row.level,
          event: row.event,
          message: row.message,
          meta: row.meta,
          createdAt: row.created_at,
          taskNo: row.task_no,
          taskId: row.task_id,
        })),
        pagination: pageMeta(Number(total?.count ?? 0), page.page, page.pageSize),
      },
    };
  });

  app.get('/admin/logs/audit', async (request) => {
    requireRole(request, 'ADMIN');
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const params: unknown[] = [];
    const conditions: string[] = ['TRUE'];
    if (raw.q) {
      params.push(`%${raw.q}%`);
      conditions.push(`(al.action ILIKE $${params.length} OR u.display_name ILIKE $${params.length} OR al.target_id ILIKE $${params.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const total = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ${where}`,
      params,
    );
    params.push(page.pageSize, page.offset);
    const rows = await q(
      `SELECT al.id, al.action, al.target_type, al.target_id, al.meta, al.ip, al.created_at,
              u.display_name AS actor_name, u.role AS actor_role
       FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
       ${where} ORDER BY al.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      data: {
        items: rows.rows.map((row) => ({
          id: String(row.id),
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          meta: row.meta,
          ip: row.ip,
          createdAt: row.created_at,
          actorName: row.actor_name,
          actorRole: row.actor_role,
        })),
        pagination: pageMeta(Number(total?.count ?? 0), page.page, page.pageSize),
      },
    };
  });

  app.get('/user/me', async (request) => {
    const actor = requireUser(request);
    const row = await one<{
      id: string; email: string; display_name: string; role: 'ADMIN'|'AGENT'|'USER';
      status: 'ACTIVE'|'DISABLED'; invite_enabled: boolean; invited_by: string | null;
      created_at: Date; last_login_at: Date | null;
    }>('SELECT id, email, display_name, role, status, invite_enabled, invited_by, created_at, last_login_at FROM users WHERE id = $1', [actor.id]);
    return { data: { user: row ? publicUser(row) : null } };
  });
}
