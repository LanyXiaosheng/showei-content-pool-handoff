import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../lib/http';
import { activatePrompt, createPromptVersion, deletePrompt, listPrompts } from '../services/prompts';
import { listProviderSummaries, saveProvider, testProvider } from '../services/providers';
import { writeAudit } from '../services/audit';

const promptCreateSchema = z.object({
  kind: z.enum(['IMAGE', 'COPY']),
  name: z.string().trim().min(2).max(120),
  content: z.record(z.unknown()),
  activate: z.boolean().optional(),
});
const providerSchema = z.object({
  provider: z.enum(['mock', 'openai']),
  baseUrl: z.string().trim().url().max(500).nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  apiKey: z.string().trim().min(4).max(500).nullable().optional(),
  clearApiKey: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

export async function promptRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/prompts', async (request) => {
    requireRole(request, 'ADMIN');
    return { data: { items: await listPrompts() } };
  });

  app.post('/admin/prompts', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const input = promptCreateSchema.parse(request.body);
    const created = await createPromptVersion(actor, input);
    return { data: created, message: `已创建 ${input.kind === 'IMAGE' ? '生图' : '文案'} Prompt v${created.version}` };
  });

  app.post('/admin/prompts/:id/activate', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const prompt = await activatePrompt(actor, id);
    return { data: prompt, message: `v${prompt.version} 已激活` };
  });

  app.delete('/admin/prompts/:id', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await deletePrompt(actor, id);
    return { data: { ok: true }, message: 'Prompt 版本已删除' };
  });

  app.get('/admin/providers', async (request) => {
    requireRole(request, 'ADMIN');
    return { data: { items: await listProviderSummaries() } };
  });

  app.put('/admin/providers/:kind', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { kind } = z.object({ kind: z.enum(['TEXT', 'IMAGE']) }).parse(request.params);
    const input = providerSchema.parse(request.body);
    await saveProvider(actor.id, kind, input);
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'PROVIDER_CONFIG_SAVED',
      targetType: 'provider',
      targetId: kind,
      meta: { provider: input.provider, baseUrl: input.baseUrl, model: input.model, keyChanged: Boolean(input.apiKey) },
    });
    return { data: { ok: true }, message: 'API 配置已保存并加密存储' };
  });

  app.post('/admin/providers/:kind/test', async (request) => {
    requireRole(request, 'ADMIN');
    const { kind } = z.object({ kind: z.enum(['TEXT', 'IMAGE']) }).parse(request.params);
    const result = await testProvider(kind);
    return { data: result, message: result.message };
  });
}
