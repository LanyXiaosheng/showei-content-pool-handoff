import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden } from '../lib/errors';
import { requireRole, requireUser, clientIp } from '../lib/http';
import { pageMeta, parsePagination } from '../lib/validation';
import {
  createTask,
  getTaskDetail,
  getTaskLogs,
  listTasks,
  retryTask,
  reviewTask,
  voidTask,
} from '../services/tasks';
import type { TaskStatus } from '../types';

const statuses = ['PENDING_REVIEW', 'REJECTED', 'QUEUED', 'GENERATING', 'COMPLETED', 'FAILED', 'VOID'] as const;

function parseStringArray(raw: unknown, field: string, maxItems: number, required = true): string[] {
  if (!required && (raw === undefined || raw === '')) return [];
  if (typeof raw !== 'string') throw badRequest(`${field}格式不正确`);
  let values: unknown;
  try {
    values = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(/[\n,，]/);
  } catch {
    throw badRequest(`${field}格式不正确`);
  }
  if (!Array.isArray(values)) throw badRequest(`${field}格式不正确`);
  const cleaned = [...new Set(values.map((value) => String(value).replace(/^#/, '').trim()).filter(Boolean))];
  if (!cleaned.length && required) throw badRequest(`请至少填写一项${field}`);
  if (cleaned.length > maxItems) throw badRequest(`${field}最多 ${maxItems} 项`);
  if (cleaned.some((value) => value.length > 120)) throw badRequest(`${field}单项过长`);
  return cleaned;
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tasks', {
    config: { rateLimit: { max: 6, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const actor = requireUser(request);
    if (actor.role === 'ADMIN') throw forbidden('管理员账号不能提交素材任务');
    if (!request.isMultipart()) throw badRequest('请使用 multipart/form-data 上传素材');
    const fields: Record<string, string> = {};
    const files: Array<{ buffer: Buffer; filename: string; mimetype: string }> = [];

    try {
      const parts = request.parts({
        limits: { fileSize: 12 * 1024 * 1024, files: 6, fields: 12, parts: 20 },
      });
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'images') {
            part.file.resume();
            continue;
          }
          const buffer = await part.toBuffer();
          if (part.file.truncated) throw badRequest('单张图片超过 12MB 限制');
          if (buffer.length === 0) throw badRequest('上传了空图片');
          files.push({ buffer, filename: part.filename || 'upload.jpg', mimetype: part.mimetype });
        } else {
          if (part.fieldname === 'generationCount' || part.fieldname === 'sourceTitle' || part.fieldname === 'sourceBody' || part.fieldname === 'sellingPoints' || part.fieldname === 'tags') {
            fields[part.fieldname] = String(part.value ?? '');
          }
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || (error as { code?: string }).code === 'FST_FILES_LIMIT') {
        throw badRequest('上传文件超出限制');
      }
      throw error;
    }

    const parsed = z.object({
      generationCount: z.coerce.number().int().min(10).max(100),
      sourceTitle: z.string().trim().min(3, '标题至少 3 个字').max(200),
      sourceBody: z.string().trim().max(8000).default(''),
    }).parse({
      generationCount: fields.generationCount,
      sourceTitle: fields.sourceTitle,
      sourceBody: fields.sourceBody,
    });
    const sellingPoints = parseStringArray(fields.sellingPoints, '卖点', 8, false);
    const tags = parseStringArray(fields.tags, '标签', 12, false);
    const task = await createTask(actor, {
      ...parsed,
      sellingPoints,
      tags,
    }, files);
    reply.code(201);
    return {
      data: { id: task.id, taskNo: task.task_no, status: task.status },
      message: '素材任务已提交，等待管理员审核',
    };
  });

  app.get('/tasks', async (request) => {
    const actor = requireUser(request);
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const status = raw.status && statuses.includes(raw.status as TaskStatus) ? (raw.status as TaskStatus) : undefined;
    const { items, total } = await listTasks(actor, {
      status,
      q: raw.q?.trim().slice(0, 80),
      page: page.page,
      pageSize: page.pageSize,
      offset: page.offset,
    });
    return { data: { items, pagination: pageMeta(total, page.page, page.pageSize) } };
  });

  app.get('/tasks/:id', async (request) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await getTaskDetail(actor, id) };
  });

  app.get('/tasks/:id/logs', async (request) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: { items: await getTaskLogs(actor, id) } };
  });

  app.post('/tasks/:id/review', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({
      decision: z.enum(['APPROVE', 'REJECT']),
      comment: z.string().trim().max(500).optional(),
    }).parse(request.body);
    const task = await reviewTask(actor, id, input.decision, input.comment, clientIp(request));
    return {
      data: { id: task.id, status: task.status },
      message: input.decision === 'APPROVE' ? '审核通过，已进入生成队列' : '任务已驳回并通知提交人',
    };
  });

  app.post('/tasks/:id/void', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const result = await voidTask(actor, id, input.reason, clientIp(request));
    return {
      data: result,
      message: `任务已作废${result.withdrawnGroups ? `，下架 ${result.withdrawnGroups} 组未领取内容` : ''}`,
    };
  });

  app.post('/tasks/:id/retry', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await retryTask(actor, id, clientIp(request));
    return { data: { ok: true }, message: '任务已重新进入生成队列' };
  });
}
