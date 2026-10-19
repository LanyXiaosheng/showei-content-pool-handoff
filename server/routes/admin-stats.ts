import type { FastifyInstance } from 'fastify';
import { one } from '../db';
import { requireRole } from '../lib/http';
import { poolStats } from '../services/pool';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/overview', async (request) => {
    requireRole(request, 'ADMIN');
    const [pool, counts] = await Promise.all([
      poolStats(),
      one<Record<string, string>>(
        `SELECT
          (SELECT count(*)::text FROM tasks) AS total_tasks,
          (SELECT count(*)::text FROM tasks WHERE status = 'PENDING_REVIEW') AS pending_tasks,
          (SELECT count(*)::text FROM generation_jobs WHERE status = 'FAILED') AS failed_jobs,
          (SELECT count(*)::text FROM users) AS total_users,
          (SELECT count(*)::text FROM users WHERE role = 'AGENT') AS total_agents,
          (SELECT count(*)::text FROM audit_logs WHERE created_at >= now() - interval '24 hours') AS audits_today`,
      ),
    ]);
    return {
      data: {
        pool,
        tasks: {
          total: Number(counts?.total_tasks ?? 0),
          pending: Number(counts?.pending_tasks ?? 0),
          failedJobs: Number(counts?.failed_jobs ?? 0),
        },
        users: {
          total: Number(counts?.total_users ?? 0),
          agents: Number(counts?.total_agents ?? 0),
        },
        auditsToday: Number(counts?.audits_today ?? 0),
      },
    };
  });
}
