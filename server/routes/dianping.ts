import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/http';
import { forbidden } from '../lib/errors';
import { importDianping } from '../services/dianping';

export async function dianpingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/imports/dianping', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  }, async (request) => {
    const actor = requireUser(request);
    if (actor.role === 'ADMIN') throw forbidden('管理员账号不能提交素材任务');
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(request.body);
    return { data: await importDianping(text) };
  });
}
