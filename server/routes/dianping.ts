import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireUser } from '../lib/http';
import { AppError, forbidden } from '../lib/errors';
import { importDianping } from '../services/dianping';
import { clearDianpingCookies, getDianpingCookieSummary, saveDianpingCookies } from '../services/dianping-cookies';
import { MAX_COOKIE_JSON_BYTES } from '../services/dianping-cookie-format';
import { auditForRequest } from '../services/audit';

export async function dianpingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/dianping-cookie', async (request) => {
    requireRole(request, 'ADMIN');
    return { data: await getDianpingCookieSummary() };
  });

  app.put('/admin/dianping-cookie', { bodyLimit: 2 * MAX_COOKIE_JSON_BYTES }, async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const { cookieJson } = z.object({ cookieJson: z.string().min(1).max(MAX_COOKIE_JSON_BYTES) }).parse(request.body);
    const summary = await saveDianpingCookies(actor.id, cookieJson);
    await auditForRequest(request, 'DIANPING_COOKIE_SAVED', 'dianping', '1', { cookieCount: summary.cookieCount });
    return { data: summary };
  });

  app.delete('/admin/dianping-cookie', async (request) => {
    const actor = requireRole(request, 'ADMIN');
    const summary = await clearDianpingCookies(actor.id);
    await auditForRequest(request, 'DIANPING_COOKIE_CLEARED', 'dianping', '1');
    return { data: summary };
  });

  app.post('/admin/dianping-cookie/test', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  }, async (request) => {
    requireRole(request, 'ADMIN');
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(request.body);
    const summary = await getDianpingCookieSummary();
    if (!summary.configured) throw new AppError(409, 'DIANPING_COOKIE_MISSING', '请先导入大众点评 Cookie');
    const result = await importDianping(text);
    return { data: { ok: true, title: result.title, message: '解析成功，其他用户可以使用共享 Cookie 解析笔记' } };
  });

  app.post('/imports/dianping', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  }, async (request) => {
    const actor = requireUser(request);
    if (actor.role === 'ADMIN') throw forbidden('管理员账号不能提交素材任务');
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(request.body);
    return { data: await importDianping(text) };
  });
}
