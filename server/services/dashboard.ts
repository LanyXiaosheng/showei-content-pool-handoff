import { one, q } from '../db';
import { listTasks } from './tasks';
import type { AuthUser } from '../types';

async function seriesFor(_actor: AuthUser) {
  const rows = await q<{ day: string; count: string }>(
    `WITH days AS (
       SELECT generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') AS day
     )
     SELECT to_char(days.day, 'MM-DD') AS day,
            count(cg.id)::text AS count
     FROM days
     LEFT JOIN content_groups cg
       ON cg.created_at >= days.day
      AND cg.created_at < days.day + interval '1 day'
      AND cg.status IN ('AVAILABLE','CLAIMED')
     GROUP BY days.day
     ORDER BY days.day`,
  );
  return rows.rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}

export async function getDashboard(actor: AuthUser) {
  const series = await seriesFor(actor);
  if (actor.role === 'ADMIN') {
    const counts = await one<Record<string, string>>(
      `SELECT
        (SELECT count(*)::text FROM users WHERE role = 'ADMIN') AS admins,
        (SELECT count(*)::text FROM users WHERE role = 'AGENT') AS agents,
        (SELECT count(*)::text FROM users WHERE role = 'USER') AS users,
        (SELECT count(*)::text FROM users WHERE status = 'ACTIVE') AS active_users,
        (SELECT count(*)::text FROM tasks WHERE status = 'PENDING_REVIEW') AS pending_tasks,
        (SELECT count(*)::text FROM tasks WHERE status IN ('QUEUED','GENERATING')) AS active_tasks,
        (SELECT count(*)::text FROM tasks WHERE status = 'COMPLETED') AS completed_tasks,
        (SELECT count(*)::text FROM tasks WHERE status = 'FAILED') AS failed_tasks,
        (SELECT count(*)::text FROM content_groups WHERE status = 'AVAILABLE') AS available_groups,
        (SELECT count(*)::text FROM content_groups WHERE status = 'CLAIMED') AS claimed_groups,
        (SELECT count(*)::text FROM content_groups WHERE status = 'STAGED') AS staged_groups,
        (SELECT count(*)::text FROM content_groups WHERE created_at >= date_trunc('day', now())) AS today_groups,
        (SELECT count(*)::text FROM generation_jobs WHERE status = 'FAILED') AS failed_jobs,
        (SELECT count(*)::text FROM generation_jobs) AS total_jobs`,
    );
    const worker = await one<{ worker_id: string; last_seen_at: Date; started_at: Date }>(
      'SELECT worker_id, last_seen_at, started_at FROM worker_heartbeat WHERE id = 1',
    );
    const recent = await listTasks(actor, { page: 1, pageSize: 6, offset: 0 });
    return {
      role: actor.role,
      stats: {
        admins: Number(counts?.admins ?? 0),
        agents: Number(counts?.agents ?? 0),
        users: Number(counts?.users ?? 0),
        activeUsers: Number(counts?.active_users ?? 0),
        pendingTasks: Number(counts?.pending_tasks ?? 0),
        activeTasks: Number(counts?.active_tasks ?? 0),
        completedTasks: Number(counts?.completed_tasks ?? 0),
        failedTasks: Number(counts?.failed_tasks ?? 0),
        availableGroups: Number(counts?.available_groups ?? 0),
        claimedGroups: Number(counts?.claimed_groups ?? 0),
        stagedGroups: Number(counts?.staged_groups ?? 0),
        todayGroups: Number(counts?.today_groups ?? 0),
        failedJobs: Number(counts?.failed_jobs ?? 0),
        totalJobs: Number(counts?.total_jobs ?? 0),
      },
      worker: {
        online: worker ? Date.now() - new Date(worker.last_seen_at).getTime() < 15_000 : false,
        workerId: worker?.worker_id ?? null,
        lastSeenAt: worker?.last_seen_at ?? null,
        startedAt: worker?.started_at ?? null,
      },
      recentTasks: recent.items,
      series,
    };
  }

  if (actor.role === 'AGENT') {
    const counts = await one<Record<string, string>>(
      `SELECT
        (SELECT count(*)::text FROM users WHERE invited_by = $1 AND role = 'USER') AS downline,
        (SELECT count(*)::text FROM users WHERE invited_by = $1 AND role = 'USER' AND status = 'ACTIVE') AS active_downline,
        (SELECT count(*)::text FROM invites WHERE created_by = $1 AND revoked_at IS NULL AND expires_at > now() AND used_count < max_uses) AS active_invites,
        (SELECT count(*)::text FROM tasks t JOIN users u ON u.id = t.submitter_id
          WHERE u.invited_by = $1 AND t.status = 'PENDING_REVIEW') AS team_pending,
        (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status = 'PENDING_REVIEW') AS my_pending,
        (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status IN ('QUEUED','GENERATING')) AS my_active,
        (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status = 'COMPLETED') AS my_completed,
        (SELECT count(*)::text FROM content_groups WHERE status = 'AVAILABLE') AS available_groups,
        (SELECT count(*)::text FROM content_groups WHERE claimed_by = $1 AND status = 'CLAIMED') AS my_claimed,
        (SELECT count(*)::text FROM content_groups WHERE created_at >= date_trunc('day', now()) AND status IN ('AVAILABLE','CLAIMED')) AS today_groups`,
      [actor.id],
    );
    const recent = await listTasks(actor, { page: 1, pageSize: 6, offset: 0 });
    return {
      role: actor.role,
      stats: {
        downline: Number(counts?.downline ?? 0),
        activeDownline: Number(counts?.active_downline ?? 0),
        activeInvites: Number(counts?.active_invites ?? 0),
        teamPending: Number(counts?.team_pending ?? 0),
        pendingTasks: Number(counts?.my_pending ?? 0),
        activeTasks: Number(counts?.my_active ?? 0),
        completedTasks: Number(counts?.my_completed ?? 0),
        availableGroups: Number(counts?.available_groups ?? 0),
        claimedGroups: Number(counts?.my_claimed ?? 0),
        todayGroups: Number(counts?.today_groups ?? 0),
        inviteEnabled: actor.inviteEnabled,
      },
      recentTasks: recent.items,
      series,
    };
  }

  const counts = await one<Record<string, string>>(
    `SELECT
      (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status = 'PENDING_REVIEW') AS pending_tasks,
      (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status IN ('QUEUED','GENERATING')) AS active_tasks,
      (SELECT count(*)::text FROM tasks WHERE submitter_id = $1 AND status = 'COMPLETED') AS completed_tasks,
      (SELECT count(*)::text FROM content_groups WHERE status = 'AVAILABLE') AS available_groups,
      (SELECT count(*)::text FROM content_groups WHERE claimed_by = $1 AND status = 'CLAIMED') AS my_claimed,
      (SELECT count(*)::text FROM content_groups WHERE created_at >= date_trunc('day', now()) AND status IN ('AVAILABLE','CLAIMED')) AS today_groups`,
    [actor.id],
  );
  const recent = await listTasks(actor, { page: 1, pageSize: 6, offset: 0 });
  return {
    role: actor.role,
    stats: {
      pendingTasks: Number(counts?.pending_tasks ?? 0),
      activeTasks: Number(counts?.active_tasks ?? 0),
      completedTasks: Number(counts?.completed_tasks ?? 0),
      availableGroups: Number(counts?.available_groups ?? 0),
      claimedGroups: Number(counts?.my_claimed ?? 0),
      todayGroups: Number(counts?.today_groups ?? 0),
    },
    recentTasks: recent.items,
    series,
  };
}
