import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forbidden, notFound } from '../lib/errors';
import { clientIp, requireRole, requireUser } from '../lib/http';
import { parsePagination, pageMeta, padGroup } from '../lib/validation';
import {
  adminListContent,
  claimGroup,
  getGroupForDownload,
  getPoolGroup,
  listMyLibrary,
  listPool,
} from '../services/pool';
import { copyTextFile } from '../services/copywriting';
import { resolveDataPath, fileExists } from '../services/storage';
import { writeAudit } from '../services/audit';
import { getTaskAccess } from '../services/tasks';
import { one } from '../db';

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
}

function sendFile(reply: FastifyReply, filePath: string, thumbnail: boolean): FastifyReply {
  reply.type(contentType(filePath));
  reply.header('Cache-Control', thumbnail ? 'private, max-age=300' : 'private, max-age=120');
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(fs.createReadStream(filePath));
}

export async function poolRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pool', async (request) => {
    const actor = requireUser(request);
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const sort = raw.sort === 'oldest' ? 'oldest' : 'latest';
    const result = await listPool(actor, { q: raw.q?.trim().slice(0, 80), sort, ...page });
    return {
      data: {
        items: result.items,
        total: result.total,
        pagination: pageMeta(result.total, page.page, page.pageSize),
        availableCount: result.total,
      },
    };
  });

  app.get('/pool/:id', async (request) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await getPoolGroup(actor, id) };
  });

  app.post('/pool/:id/claim', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const actor = requireUser(request);
    if (actor.role === 'ADMIN') throw forbidden('管理员不参与领取');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const group = await claimGroup(actor, id, clientIp(request));
    return {
      data: { id: group.id, groupCode: group.group_code, status: 'CLAIMED' },
      message: '领取成功，这组内容已从公共池下架',
    };
  });

  app.get('/library', async (request) => {
    const actor = requireUser(request);
    if (actor.role === 'ADMIN') throw forbidden('管理员请使用内容管理查看全部内容');
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const result = await listMyLibrary(actor, { q: raw.q?.trim().slice(0, 80), ...page });
    return {
      data: {
        items: result.items,
        total: result.total,
        pagination: pageMeta(result.total, page.page, page.pageSize),
      },
    };
  });

  app.get('/content/:id/download', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { group, images } = await getGroupForDownload(actor, id);
    const files = await Promise.all(
      images.map(async (image) => ({ image, absolute: resolveDataPath(image.file_path) })),
    );
    for (const file of files) {
      if (!(await fileExists(file.absolute))) {
        app.log.error({ groupId: group.id, path: file.image.file_path }, '下载时发现生成图片缺失');
        throw notFound('内容文件缺失，请联系管理员');
      }
    }
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'CONTENT_DOWNLOADED',
      targetType: 'content_group',
      targetId: group.id,
      meta: { groupCode: group.group_code, images: images.length },
      ip: clientIp(request),
    });
    const folder = padGroup(group.group_no);
    const filename = `${group.group_code}_${folder}.zip`;
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Cache-Control', 'no-store');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (error) => app.log.warn({ err: error }, 'ZIP 打包警告'));
    archive.on('error', (error) => {
      app.log.error({ err: error }, 'ZIP 打包失败');
      reply.raw.destroy(error);
    });
    reply.send(archive);
    files.forEach((file, index) => {
      archive.file(file.absolute, {
        name: `${folder}/image_${String(index + 1).padStart(2, '0')}.jpg`,
      });
    });
    archive.append(`\ufeff${copyTextFile({ title: group.title, body: group.body, tags: group.tags })}`, {
      name: `${folder}/文案.txt`,
    });
    await archive.finalize();
  });

  app.get('/admin/content', async (request) => {
    requireRole(request, 'ADMIN');
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const status = ['STAGED', 'AVAILABLE', 'CLAIMED', 'WITHDRAWN'].includes(raw.status ?? '') ? raw.status : undefined;
    const result = await adminListContent({ status, q: raw.q?.slice(0, 80), ...page });
    return {
      data: {
        items: result.items,
        total: result.total,
        pagination: pageMeta(result.total, page.page, page.pageSize),
      },
    };
  });

  app.get('/media/task-images/:id', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const image = await one<{ task_id: string; file_path: string; thumb_path: string }>(
      'SELECT task_id, file_path, thumb_path FROM task_images WHERE id = $1',
      [id],
    );
    if (!image) throw notFound('图片不存在');
    await getTaskAccess(actor, image.task_id);
    const thumbnail = (request.query as { thumb?: string }).thumb === '1';
    return sendFile(reply, resolveDataPath(thumbnail ? image.thumb_path : image.file_path), thumbnail);
  });

  app.get('/media/group-images/:id', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const image = await one<{
      status: string; claimed_by: string | null; file_path: string; thumb_path: string;
    }>(
      `SELECT cg.status, cg.claimed_by, cgi.file_path, cgi.thumb_path
       FROM content_group_images cgi JOIN content_groups cg ON cg.id = cgi.group_id
       WHERE cgi.id = $1`,
      [id],
    );
    if (!image) throw notFound('图片不存在');
    const allowed =
      image.status === 'AVAILABLE'
        ? true
        : actor.role === 'ADMIN'
          ? true
          : image.status === 'CLAIMED' && image.claimed_by === actor.id;
    if (!allowed) throw notFound('图片不存在');
    const thumbnail = (request.query as { thumb?: string }).thumb === '1';
    return sendFile(reply, resolveDataPath(thumbnail ? image.thumb_path : image.file_path), thumbnail);
  });
}
