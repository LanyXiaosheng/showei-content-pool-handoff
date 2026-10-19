import { one, q, withTx } from '../db';
import { conflict, forbidden, notFound } from '../lib/errors';
import { writeAudit } from './audit';
import type { AuthUser } from '../types';

interface PoolFilters {
  q?: string;
  sort?: 'latest' | 'oldest';
  page: number;
  pageSize: number;
  offset: number;
}

export async function listPool(actor: AuthUser, filters: PoolFilters) {
  if (!['ADMIN', 'AGENT', 'USER'].includes(actor.role)) throw forbidden();
  const params: unknown[] = [];
  const conditions = [`cg.status = 'AVAILABLE'`];
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(cg.title ILIKE $${params.length} OR cg.body ILIKE $${params.length} OR cg.tags::text ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const order = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  const total = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM content_groups cg ${where}`,
    params,
  );
  params.push(filters.pageSize, filters.offset);
  const rows = await q(
    `SELECT cg.id, cg.group_code, cg.title, cg.body, cg.tags, cg.created_at,
            (SELECT cgi.id FROM content_group_images cgi WHERE cgi.group_id = cg.id ORDER BY sort_order LIMIT 1) AS cover_image_id,
            (SELECT count(*)::int FROM content_group_images cgi WHERE cgi.group_id = cg.id) AS image_count
     FROM content_groups cg
     ${where}
     ORDER BY cg.created_at ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      groupCode: row.group_code,
      title: row.title,
      preview: String(row.body).replace(/\s+/g, ' ').slice(0, 120),
      tags: row.tags,
      createdAt: row.created_at,
      coverImageId: row.cover_image_id,
      imageCount: Number(row.image_count ?? 0),
      remaining: 1,
    })),
    total: Number(total?.count ?? 0),
  };
}

export async function getPoolGroup(actor: AuthUser, groupId: string) {
  const group = await one<{
    id: string; group_code: string; title: string; body: string; tags: string[];
    status: string; claimed_by: string | null; claimed_at: Date | null; created_at: Date;
  }>('SELECT id, group_code, title, body, tags, status, claimed_by, claimed_at, created_at FROM content_groups WHERE id = $1', [groupId]);
  if (!group) throw notFound('内容组不存在');
  const images = await q<{ id: string; width: number; height: number }>(
    'SELECT id, width, height FROM content_group_images WHERE group_id = $1 ORDER BY sort_order',
    [groupId],
  );
  const isOwner = group.claimed_by === actor.id;
  const isAdmin = actor.role === 'ADMIN';
  if (group.status === 'CLAIMED' && !isOwner && !isAdmin) throw notFound('内容组不存在或已被领取');
  if (group.status === 'STAGED' && !isAdmin) throw notFound('内容组不存在');
  if (group.status === 'WITHDRAWN' && !isAdmin) throw notFound('内容组不存在');
  return {
    id: group.id,
    groupCode: group.group_code,
    title: group.title,
    preview: String(group.body).replace(/\s+/g, ' ').slice(0, 120),
    body: isOwner || isAdmin ? group.body : undefined,
    tags: group.tags,
    status: group.status,
    claimedAt: group.claimed_at,
    isOwner,
    createdAt: group.created_at,
    images: images.rows.map((image) => ({ id: image.id, width: image.width, height: image.height })),
    remaining: group.status === 'AVAILABLE' ? 1 : 0,
  };
}

export async function claimGroup(actor: AuthUser, groupId: string, ip: string) {
  if (actor.role === 'ADMIN') throw forbidden('管理员不参与领取，请使用普通用户或代理账号');
  return withTx(async (client) => {
    const updated = await client.query<{
      id: string; group_no: number; task_id: string; group_code: string; title: string;
    }>(
      `UPDATE content_groups
       SET status = 'CLAIMED', claimed_by = $1, claimed_at = now()
       WHERE id = $2 AND status = 'AVAILABLE'
       RETURNING id, group_no, task_id, group_code, title`,
      [actor.id, groupId],
    );
    if (!updated.rows[0]) {
      const current = await client.query<{ status: string; claimed_by: string | null }>(
        'SELECT status, claimed_by FROM content_groups WHERE id = $1',
        [groupId],
      );
      if (!current.rows[0] || current.rows[0].status === 'WITHDRAWN' || current.rows[0].status === 'STAGED') {
        throw notFound('该内容组不存在或已下架');
      }
      if (current.rows[0].status === 'CLAIMED' && current.rows[0].claimed_by === actor.id) {
        throw conflict('你已经领取过这一组内容', 'ALREADY_CLAIMED');
      }
      throw conflict('手慢了，这一组刚刚被其他用户领取', 'CONTENT_TAKEN');
    }
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'CONTENT_CLAIMED',
        targetType: 'content_group',
        targetId: groupId,
        meta: {
          groupNo: updated.rows[0].group_no,
          taskId: updated.rows[0].task_id,
          groupCode: updated.rows[0].group_code,
        },
        ip,
      },
      client,
    );
    return updated.rows[0];
  });
}

export async function listMyLibrary(actor: AuthUser, filters: PoolFilters) {
  const params: unknown[] = [actor.id];
  const conditions = [`cg.status = 'CLAIMED'`, `cg.claimed_by = $1`];
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(cg.title ILIKE $${params.length} OR cg.tags::text ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM content_groups cg ${where}`,
    params,
  );
  params.push(filters.pageSize, filters.offset);
  const rows = await q(
    `SELECT cg.id, cg.group_code, cg.title, cg.body, cg.tags, cg.claimed_at, t.task_no,
            (SELECT cgi.id FROM content_group_images cgi WHERE cgi.group_id = cg.id ORDER BY sort_order LIMIT 1) AS cover_image_id,
            (SELECT count(*)::int FROM content_group_images cgi WHERE cgi.group_id = cg.id) AS image_count
     FROM content_groups cg JOIN tasks t ON t.id = cg.task_id
     ${where}
     ORDER BY cg.claimed_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      groupCode: row.group_code,
      title: row.title,
      body: row.body,
      tags: row.tags,
      claimedAt: row.claimed_at,
      taskNo: row.task_no,
      coverImageId: row.cover_image_id,
      imageCount: Number(row.image_count ?? 0),
    })),
    total: Number(total?.count ?? 0),
  };
}

export async function getGroupForDownload(actor: AuthUser, groupId: string) {
  const group = await one<{
    id: string; group_no: number; group_code: string; title: string; body: string; tags: string[];
    status: string; claimed_by: string | null;
  }>('SELECT id, group_no, group_code, title, body, tags, status, claimed_by FROM content_groups WHERE id = $1', [groupId]);
  if (!group) throw notFound('内容组不存在');
  if (actor.role !== 'ADMIN' && group.claimed_by !== actor.id) {
    throw forbidden('只能下载自己已领取的内容');
  }
  if (group.status !== 'CLAIMED' && actor.role !== 'ADMIN') throw forbidden('该内容尚未被领取或已下架');
  const images = await q<{ file_path: string }>(
    'SELECT file_path FROM content_group_images WHERE group_id = $1 ORDER BY sort_order',
    [groupId],
  );
  return { group, images: images.rows };
}

export async function adminListContent(filters: {
  status?: string;
  q?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const params: unknown[] = [];
  const conditions: string[] = ['TRUE'];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`cg.status = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`(cg.title ILIKE $${params.length} OR cg.group_code ILIKE $${params.length} OR t.task_no ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM content_groups cg JOIN tasks t ON t.id = cg.task_id ${where}`,
    params,
  );
  params.push(filters.pageSize, filters.offset);
  const rows = await q(
    `SELECT cg.id, cg.group_code, cg.group_no, cg.title, cg.status, cg.claimed_at, cg.created_at,
            t.task_no, t.source_title, u.display_name AS claimant_name,
            (SELECT cgi.id FROM content_group_images cgi WHERE cgi.group_id = cg.id ORDER BY sort_order LIMIT 1) AS cover_image_id,
            (SELECT count(*)::int FROM content_group_images cgi WHERE cgi.group_id = cg.id) AS image_count
     FROM content_groups cg
     JOIN tasks t ON t.id = cg.task_id
     LEFT JOIN users u ON u.id = cg.claimed_by
     ${where}
     ORDER BY cg.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      groupCode: row.group_code,
      groupNo: row.group_no,
      title: row.title,
      status: row.status,
      taskNo: row.task_no,
      sourceTitle: row.source_title,
      claimantName: row.claimant_name,
      claimedAt: row.claimed_at,
      createdAt: row.created_at,
      coverImageId: row.cover_image_id,
      imageCount: Number(row.image_count ?? 0),
    })),
    total: Number(total?.count ?? 0),
  };
}

export async function poolStats() {
  const stats = await one<{ available: string; claimed: string; today: string }>(
    `SELECT
      (SELECT count(*)::text FROM content_groups WHERE status = 'AVAILABLE') AS available,
      (SELECT count(*)::text FROM content_groups WHERE status = 'CLAIMED') AS claimed,
      (SELECT count(*)::text FROM content_groups WHERE created_at >= date_trunc('day', now()) AND status IN ('AVAILABLE','CLAIMED')) AS today`,
  );
  return {
    available: Number(stats?.available ?? 0),
    claimed: Number(stats?.claimed ?? 0),
    today: Number(stats?.today ?? 0),
  };
}
