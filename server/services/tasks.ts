import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, q, withTx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { processTaskImages, cleanupTaskUpload } from './storage';
import { getActivePrompts } from './prompts';
import { loadProvider } from './providers';
import { createNotification, writeAudit } from './audit';
import type { AuthUser, JobRow, TaskImageRow, TaskRow, TaskStatus } from '../types';

export interface TaskInput {
  generationCount: number;
  sourceTitle: string;
  sourceBody: string;
  sellingPoints: string[];
  tags: string[];
}

interface TaskListFilters {
  status?: TaskStatus;
  q?: string;
  page: number;
  pageSize: number;
  offset: number;
}

function makeTaskNo(): string {
  const now = new Date();
  const date = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `T${date}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function scopeSql(actor: AuthUser, params: unknown[]): { sql: string; params: unknown[] } {
  if (actor.role === 'ADMIN') return { sql: 'TRUE', params };
  if (actor.role === 'AGENT') {
    params.push(actor.id);
    return {
      sql: `(t.submitter_id = $${params.length} OR EXISTS (
        SELECT 1 FROM users du WHERE du.id = t.submitter_id AND du.invited_by = $${params.length} AND du.role = 'USER'
      ))`,
      params,
    };
  }
  params.push(actor.id);
  return { sql: `t.submitter_id = $${params.length}`, params };
}

export async function createTask(
  actor: AuthUser,
  input: TaskInput,
  files: Array<{ buffer: Buffer; filename: string; mimetype: string }>,
) {
  if (actor.role === 'ADMIN') throw forbidden('管理员不提交素材任务，请使用代理或用户账号测试');
  if (!Number.isInteger(input.generationCount) || input.generationCount < 10 || input.generationCount > 100) {
    throw badRequest('生成组数必须在 10 到 100 之间');
  }
  const taskId = crypto.randomUUID();
  let stored;
  try {
    stored = await processTaskImages(taskId, files);
  } catch (error) {
    await cleanupTaskUpload(taskId);
    throw error;
  }

  try {
    const task = await withTx(async (client) => {
      let inserted: TaskRow | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const result = await client.query<TaskRow>(
            `INSERT INTO tasks (id, task_no, submitter_id, generation_count, source_title, source_body, selling_points, tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
              taskId,
              makeTaskNo(),
              actor.id,
              input.generationCount,
              input.sourceTitle,
              input.sourceBody,
              JSON.stringify(input.sellingPoints),
              JSON.stringify(input.tags),
            ],
          );
          inserted = result.rows[0];
          break;
        } catch (error) {
          if ((error as { code?: string }).code === '23505' && attempt < 4) continue;
          throw error;
        }
      }
      if (!inserted) throw new Error('任务编号生成失败');
      for (const image of stored!) {
        await client.query(
          `INSERT INTO task_images (task_id, file_path, thumb_path, original_name, mime_type, byte_size, width, height, sha256, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            taskId, image.filePath, image.thumbPath, image.originalName, image.mimeType,
            image.byteSize, image.width, image.height, image.sha256, image.sortOrder,
          ],
        );
      }
      await client.query(
        `INSERT INTO notifications (user_id, kind, title, body, task_id)
         SELECT id, 'TASK_REVIEW', '有新的素材任务待审核', $1, $2 FROM users WHERE role = 'ADMIN'`,
        [`${actor.displayName} 提交了 ${input.generationCount} 组生成任务 ${inserted.task_no}。`, taskId],
      );
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'TASK_SUBMITTED',
          targetType: 'task',
          targetId: taskId,
          meta: { taskNo: inserted.task_no, generationCount: input.generationCount },
        },
        client,
      );
      return inserted;
    });
    return task;
  } catch (error) {
    await cleanupTaskUpload(taskId);
    throw error;
  }
}

export async function listTasks(actor: AuthUser, filters: TaskListFilters) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const scope = scopeSql(actor, params);
  conditions.push(scope.sql);
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(t.task_no ILIKE $${params.length} OR t.source_title ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const totalRow = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM tasks t ${where}`,
    params,
  );
  params.push(filters.pageSize, filters.offset);
  const rows = await q(
    `SELECT t.*, u.display_name AS submitter_name, u.email AS submitter_email, u.role AS submitter_role,
            j.status AS job_status, j.completed_groups, j.total_groups, j.attempts AS job_attempts,
            (SELECT count(*)::int FROM task_images ti WHERE ti.task_id = t.id) AS image_count,
            (SELECT ti.id FROM task_images ti WHERE ti.task_id = t.id ORDER BY sort_order LIMIT 1) AS cover_image_id,
            (SELECT count(*)::int FROM content_groups cg WHERE cg.task_id = t.id AND cg.status = 'AVAILABLE') AS available_groups,
            (SELECT count(*)::int FROM content_groups cg WHERE cg.task_id = t.id AND cg.status = 'CLAIMED') AS claimed_groups
     FROM tasks t
     JOIN users u ON u.id = t.submitter_id
     LEFT JOIN generation_jobs j ON j.task_id = t.id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map(serializeTask),
    total: Number(totalRow?.count ?? 0),
  };
}

function serializeTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    taskNo: row.task_no,
    status: row.status,
    generationCount: row.generation_count,
    sourceTitle: row.source_title,
    sourceBody: row.source_body,
    sellingPoints: row.selling_points,
    tags: row.tags,
    reviewComment: row.review_comment,
    reviewedAt: row.reviewed_at,
    voidReason: row.void_reason,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submitter: {
      id: row.submitter_id,
      displayName: row.submitter_name,
      email: row.submitter_email,
      role: row.submitter_role,
    },
    imageCount: Number(row.image_count ?? 0),
    coverImageId: row.cover_image_id ?? null,
    availableGroups: Number(row.available_groups ?? 0),
    claimedGroups: Number(row.claimed_groups ?? 0),
    job: row.job_status
      ? {
          status: row.job_status,
          completedGroups: Number(row.completed_groups ?? 0),
          totalGroups: Number(row.total_groups ?? 0),
          attempts: Number(row.job_attempts ?? 0),
        }
      : null,
  };
}

export async function getTaskAccess(actor: AuthUser, taskId: string) {
  const task = await one<TaskRow>(
    `SELECT t.* FROM tasks t WHERE t.id = $1`,
    [taskId],
  );
  if (!task) throw notFound('任务不存在');
  if (actor.role === 'ADMIN' || task.submitter_id === actor.id) return task;
  if (actor.role === 'AGENT') {
    const downline = await one<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND invited_by = $2 AND role = 'USER'`,
      [task.submitter_id, actor.id],
    );
    if (downline) return task;
  }
  throw forbidden('无权查看该任务');
}

export async function getTaskDetail(actor: AuthUser, taskId: string) {
  const task = await getTaskAccess(actor, taskId);
  const images = await q<TaskImageRow>(
    'SELECT * FROM task_images WHERE task_id = $1 ORDER BY sort_order',
    [taskId],
  );
  const job = await one<JobRow>('SELECT * FROM generation_jobs WHERE task_id = $1', [taskId]);
  const submitter = await one<{ display_name: string; email: string; role: string }>(
    'SELECT display_name, email, role FROM users WHERE id = $1',
    [task.submitter_id],
  );
  const counts = await one<{
    available: string; claimed: string; withdrawn: string; images: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM content_groups WHERE task_id = $1 AND status = 'AVAILABLE') AS available,
       (SELECT count(*)::text FROM content_groups WHERE task_id = $1 AND status = 'CLAIMED') AS claimed,
       (SELECT count(*)::text FROM content_groups WHERE task_id = $1 AND status = 'WITHDRAWN') AS withdrawn,
       (SELECT count(*)::text FROM content_group_images cgi
          JOIN content_groups cg ON cg.id = cgi.group_id WHERE cg.task_id = $1) AS images`,
    [taskId],
  );
  return {
    ...serializeTask({
      ...task,
      submitter_id: task.submitter_id,
      submitter_name: submitter?.display_name ?? '未知',
      submitter_email: submitter?.email ?? '',
      submitter_role: submitter?.role ?? 'USER',
      image_count: images.rowCount,
      cover_image_id: images.rows[0]?.id ?? null,
      job_status: job?.status,
      completed_groups: job?.completed_groups,
      total_groups: job?.total_groups,
      job_attempts: job?.attempts,
      available_groups: counts?.available ?? 0,
      claimed_groups: counts?.claimed ?? 0,
    }),
    review: {
      reviewedBy: task.reviewed_by,
      reviewedAt: task.reviewed_at,
      comment: task.review_comment,
    },
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          completedGroups: job.completed_groups,
          totalGroups: job.total_groups,
          lastError: job.last_error,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
        }
      : null,
    counts: {
      available: Number(counts?.available ?? 0),
      claimed: Number(counts?.claimed ?? 0),
      withdrawn: Number(counts?.withdrawn ?? 0),
      generatedImages: Number(counts?.images ?? 0),
    },
    images: images.rows.map((image) => ({
      id: image.id,
      originalName: image.original_name,
      width: image.width,
      height: image.height,
      byteSize: image.byte_size,
      sortOrder: image.sort_order,
    })),
    permissions: {
      canReview: actor.role === 'ADMIN' && task.status === 'PENDING_REVIEW',
      canVoid: actor.role === 'ADMIN' && task.status !== 'VOID',
      canRetry: actor.role === 'ADMIN' && task.status === 'FAILED',
    },
  };
}

export async function reviewTask(
  actor: AuthUser,
  taskId: string,
  decision: 'APPROVE' | 'REJECT',
  comment: string | undefined,
  ip: string,
) {
  if (actor.role !== 'ADMIN') throw forbidden();
  if (decision === 'REJECT' && (!comment || comment.trim().length < 2)) {
    throw badRequest('驳回时必须填写驳回理由');
  }

  let snapshot = null;
  if (decision === 'APPROVE') {
    snapshot = await getActivePrompts();
    await Promise.all([loadProvider('TEXT'), loadProvider('IMAGE')]);
  }

  return withTx(async (client) => {
    const result = await client.query<TaskRow>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const task = result.rows[0];
    if (!task) throw notFound('任务不存在');
    if (task.status !== 'PENDING_REVIEW') throw conflict('该任务已经处理过，不能重复审核', 'TASK_ALREADY_REVIEWED');

    if (decision === 'REJECT') {
      const updated = await client.query<TaskRow>(
        `UPDATE tasks SET status = 'REJECTED', review_comment = $1, reviewed_by = $2, reviewed_at = now()
         WHERE id = $3 RETURNING *`,
        [comment!.trim(), actor.id, taskId],
      );
      await createNotification(
        client,
        task.submitter_id,
        'TASK_REJECTED',
        `任务 ${task.task_no} 未通过审核`,
        `驳回理由：${comment!.trim()}`,
        taskId,
      );
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'TASK_REJECTED',
          targetType: 'task',
          targetId: taskId,
          meta: { comment: comment!.trim() },
          ip,
        },
        client,
      );
      return updated.rows[0];
    }

    const updated = await client.query<TaskRow>(
      `UPDATE tasks SET status = 'QUEUED', review_comment = NULL, reviewed_by = $1, reviewed_at = now()
       WHERE id = $2 RETURNING *`,
      [actor.id, taskId],
    );
    await client.query(
      `INSERT INTO generation_jobs (task_id, total_groups, prompt_snapshot)
       VALUES ($1,$2,$3)`,
      [taskId, task.generation_count, JSON.stringify(snapshot)],
    );
    await createNotification(
      client,
      task.submitter_id,
      'TASK_APPROVED',
      `任务 ${task.task_no} 已通过审核`,
      `已进入生成队列，将生成 ${task.generation_count} 组内容并放入公共内容池。生成结果不会自动分配给你，需自行领取。`,
      taskId,
    );
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'TASK_APPROVED',
        targetType: 'task',
        targetId: taskId,
        meta: { generationCount: task.generation_count },
        ip,
      },
      client,
    );
    return updated.rows[0];
  });
}

export async function voidTask(actor: AuthUser, taskId: string, reason: string, ip: string) {
  if (actor.role !== 'ADMIN') throw forbidden();
  if (!reason.trim()) throw badRequest('作废任务必须填写原因');
  return withTx(async (client) => {
    const taskResult = await client.query<TaskRow>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const task = taskResult.rows[0];
    if (!task) throw notFound('任务不存在');
    if (task.status === 'VOID') throw conflict('任务已作废', 'TASK_VOID');
    await client.query(
      `UPDATE tasks SET status = 'VOID', void_reason = $1 WHERE id = $2`,
      [reason.trim(), taskId],
    );
    await client.query(
      `UPDATE generation_jobs SET status = 'CANCELLED', finished_at = now(), locked_at = NULL, locked_by = NULL
       WHERE task_id = $1 AND status IN ('QUEUED', 'RUNNING')`,
      [taskId],
    );
    const withdrawn = await client.query(
      `UPDATE content_groups SET status = 'WITHDRAWN'
       WHERE task_id = $1 AND status IN ('STAGED','AVAILABLE')`,
      [taskId],
    );
    await createNotification(
      client,
      task.submitter_id,
      'TASK_VOID',
      `任务 ${task.task_no} 已被管理员作废`,
      `原因：${reason.trim()}`,
      taskId,
    );
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'TASK_VOIDED',
        targetType: 'task',
        targetId: taskId,
        meta: { reason: reason.trim(), withdrawnGroups: withdrawn.rowCount },
        ip,
      },
      client,
    );
    return { withdrawnGroups: withdrawn.rowCount ?? 0 };
  });
}

export async function retryTask(actor: AuthUser, taskId: string, ip: string) {
  if (actor.role !== 'ADMIN') throw forbidden();
  return withTx(async (client) => {
    const taskResult = await client.query<TaskRow>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const task = taskResult.rows[0];
    if (!task) throw notFound('任务不存在');
    if (task.status !== 'FAILED') throw conflict('只有失败任务可以重试', 'TASK_NOT_FAILED');
    const job = await client.query<JobRow>('SELECT * FROM generation_jobs WHERE task_id = $1 FOR UPDATE', [taskId]);
    if (!job.rows[0]) throw conflict('任务没有可重试的生成队列', 'JOB_NOT_FOUND');
    const groupCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM content_groups WHERE task_id = $1`,
      [taskId],
    );
    await client.query(
      `UPDATE generation_jobs SET status = 'QUEUED', attempts = 0, available_at = now(),
         locked_at = NULL, locked_by = NULL, last_error = NULL, finished_at = NULL,
         completed_groups = $1 WHERE task_id = $2`,
      [Number(groupCount.rows[0]?.count ?? 0), taskId],
    );
    await client.query(
      `UPDATE tasks SET status = 'QUEUED', failure_reason = NULL WHERE id = $1`,
      [taskId],
    );
    await client.query(
      `INSERT INTO generation_logs (task_id, job_id, level, event, message)
       VALUES ($1,$2,'INFO','JOB_MANUAL_RETRY','管理员手动重新入队')`,
      [taskId, job.rows[0].id],
    );
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'TASK_RETRIED',
        targetType: 'task',
        targetId: taskId,
        ip,
      },
      client,
    );
    return { ok: true };
  });
}

export async function getTaskLogs(actor: AuthUser, taskId: string, limit = 200) {
  await getTaskAccess(actor, taskId);
  const rows = await q<{
    id: string; level: string; event: string; message: string; meta: Record<string, unknown>; created_at: Date;
  }>(
    `SELECT id, level, event, message, meta, created_at
     FROM generation_logs WHERE task_id = $1 ORDER BY id DESC LIMIT $2`,
    [taskId, Math.min(limit, 500)],
  );
  if (actor.role === 'ADMIN') return rows.rows;
  // 代理 / 普通用户可见任务日志，但隐藏由 Prompt 变体选项产生的元数据。
  return rows.rows.map((row) => ({
    ...row,
    meta: {
      ...(typeof row.meta.attempt === 'number' ? { attempt: row.meta.attempt } : {}),
      ...(typeof row.meta.groupNo === 'number' ? { groupNo: row.meta.groupNo } : {}),
      ...(typeof row.meta.groupCode === 'string' ? { groupCode: row.meta.groupCode } : {}),
      ...(typeof row.meta.threshold === 'number' ? { threshold: row.meta.threshold } : {}),
      ...(typeof row.meta.maxCorrelation === 'number' ? { maxCorrelation: row.meta.maxCorrelation } : {}),
    },
  }));
}
