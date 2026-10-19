import { z } from 'zod';
import { one, q, withTx } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { DEFAULT_COPY_PROMPT, DEFAULT_IMAGE_PROMPT } from '../defaults';
import type { AuthUser, CopyPromptContent, ImagePromptContent, PromptSnapshot } from '../types';
import { writeAudit } from './audit';

export const imagePromptSchema = z.object({
  positiveTemplate: z.string().trim().min(20).max(5000),
  negativeTemplate: z.string().trim().min(10).max(3000),
  variantOptions: z.object({
    angles: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
    crops: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
    garnishes: z.array(z.string().trim().min(1).max(160)).min(2).max(20),
    lights: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
  }),
  outputSize: z.string().regex(/^\d{3,4}x\d{3,4}$/).default('1024x1536'),
});

const stringList = (min: number, max: number, itemMax = 120) =>
  z.array(z.string().trim().min(1).max(itemMax)).min(min).max(max);

export const copyPromptSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(4000),
  userTemplate: z.string().trim().min(20).max(8000),
  titleHooks: stringList(3, 30, 100),
  openingLines: stringList(2, 20, 160),
  narrativeStructures: stringList(2, 12, 80),
  tagLibrary: stringList(5, 80, 40),
});

export function validatePromptContent(kind: 'IMAGE' | 'COPY', content: unknown): ImagePromptContent | CopyPromptContent {
  if (kind === 'IMAGE') return imagePromptSchema.parse(content);
  return copyPromptSchema.parse(content);
}

interface PromptRow {
  id: string;
  kind: 'IMAGE' | 'COPY';
  name: string;
  version: number;
  content: ImagePromptContent | CopyPromptContent;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  creator_name: string | null;
}

function serializePrompt(row: PromptRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    version: row.version,
    content: row.content,
    isActive: row.is_active,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
  };
}

export async function listPrompts() {
  const rows = await q<PromptRow>(
    `SELECT p.*, u.display_name AS creator_name
     FROM prompt_templates p LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.kind, p.version DESC`,
  );
  return rows.rows.map(serializePrompt);
}

export async function getActivePrompts(): Promise<PromptSnapshot> {
  const rows = await q<Pick<PromptRow, 'id' | 'kind' | 'version' | 'content'>>(
    `SELECT id, kind, version, content FROM prompt_templates WHERE is_active = true`,
  );
  const image = rows.rows.find((row) => row.kind === 'IMAGE');
  const copy = rows.rows.find((row) => row.kind === 'COPY');
  if (!image || !copy) throw conflict('生图或文案 Prompt 尚未激活，请管理员先配置模板', 'PROMPT_NOT_ACTIVE');
  return {
    image: { id: image.id, version: image.version, content: image.content as ImagePromptContent },
    copy: { id: copy.id, version: copy.version, content: copy.content as CopyPromptContent },
  };
}

export async function createPromptVersion(actor: AuthUser, input: {
  kind: 'IMAGE' | 'COPY';
  name: string;
  content: unknown;
  activate?: boolean;
}) {
  const content = validatePromptContent(input.kind, input.content);
  const prompt = await withTx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`prompt:${input.kind}`]);
    const versionResult = await client.query<{ max: number | null }>(
      'SELECT max(version) AS max FROM prompt_templates WHERE kind = $1',
      [input.kind],
    );
    const version = (versionResult.rows[0]?.max ?? 0) + 1;
    const activeResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM prompt_templates WHERE kind = $1 AND is_active = true',
      [input.kind],
    );
    const shouldActivate = Boolean(input.activate) || Number(activeResult.rows[0]?.count ?? 0) === 0;
    if (shouldActivate) {
      await client.query('UPDATE prompt_templates SET is_active = false WHERE kind = $1', [input.kind]);
    }
    const inserted = await client.query<PromptRow>(
      `INSERT INTO prompt_templates (kind, name, version, content, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [input.kind, input.name.trim(), version, JSON.stringify(content), shouldActivate, actor.id],
    );
    return inserted.rows[0];
  });
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PROMPT_VERSION_CREATED',
    targetType: 'prompt',
    targetId: prompt.id,
    meta: { kind: input.kind, version: prompt.version, active: prompt.is_active },
  });
  return { ...prompt, isActive: prompt.is_active };
}

export async function activatePrompt(actor: AuthUser, promptId: string) {
  const prompt = await withTx(async (client) => {
    const found = await client.query<PromptRow>('SELECT * FROM prompt_templates WHERE id = $1 FOR UPDATE', [promptId]);
    const row = found.rows[0];
    if (!row) throw notFound('Prompt 版本不存在');
    await client.query('UPDATE prompt_templates SET is_active = false WHERE kind = $1', [row.kind]);
    const updated = await client.query<PromptRow>(
      'UPDATE prompt_templates SET is_active = true WHERE id = $1 RETURNING *',
      [promptId],
    );
    return updated.rows[0];
  });
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PROMPT_ACTIVATED',
    targetType: 'prompt',
    targetId: promptId,
    meta: { kind: prompt.kind, version: prompt.version },
  });
  return { ...prompt, isActive: prompt.is_active };
}

export async function deletePrompt(actor: AuthUser, promptId: string) {
  const row = await one<PromptRow>('SELECT * FROM prompt_templates WHERE id = $1', [promptId]);
  if (!row) throw notFound('Prompt 版本不存在');
  if (row.is_active) throw conflict('当前激活版本不能删除，请先激活其它版本', 'PROMPT_ACTIVE');
  await q('DELETE FROM prompt_templates WHERE id = $1', [promptId]);
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PROMPT_VERSION_DELETED',
    targetType: 'prompt',
    targetId: promptId,
    meta: { kind: row.kind, version: row.version },
  });
}

export function getDefaultPromptContent(kind: 'IMAGE' | 'COPY') {
  return kind === 'IMAGE' ? DEFAULT_IMAGE_PROMPT : DEFAULT_COPY_PROMPT;
}
