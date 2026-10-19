import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/http';
import { pageMeta, parsePagination } from '../lib/validation';
import { checkInvite, listInvites, revokeInvite } from '../services/invites';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invites/check/:code', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(24) }).parse(request.params);
    return { data: await checkInvite(code) };
  });

  app.get('/invites', async (request) => {
    const actor = requireUser(request);
    const raw = request.query as Record<string, string | undefined>;
    const page = parsePagination(raw);
    const status = ['ACTIVE', 'EXPIRED', 'USED', 'REVOKED'].includes(raw.status ?? '') ? raw.status : undefined;
    const result = await listInvites(actor, { status, ...page });
    return {
      data: {
        items: result.items,
        pagination: pageMeta(result.total, page.page, page.pageSize),
        inviteEnabled: actor.role === 'AGENT' ? actor.inviteEnabled : true,
      },
    };
  });

  app.post('/invites/:id/revoke', async (request) => {
    const actor = requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await revokeInvite(actor, id);
    return { data: { ok: true }, message: '邀请码已撤销' };
  });
}
