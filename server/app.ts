import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { logger } from './lib/logger';
import { assertDbHealthy, one } from './db';
import { AppError, forbidden, normalizeError } from './lib/errors';
import { resolveSession } from './services/session';
import { ensureDataDirs } from './services/storage';
import { authRoutes } from './routes/auth';
import { inviteRoutes } from './routes/invites';
import { userRoutes } from './routes/users';
import { taskRoutes } from './routes/tasks';
import { promptRoutes } from './routes/prompts';
import { poolRoutes } from './routes/pool';
import { miscRoutes } from './routes/misc';
import { statsRoutes } from './routes/admin-stats';
import { dianpingRoutes } from './routes/dianping';

const PUBLIC_API = [
  /^\/api\/health$/,
  /^\/api\/public\/config$/,
  /^\/api\/public\/hero-image$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
  /^\/api\/auth\/demo-login$/,
  /^\/api\/invites\/check\/[^/]+$/,
];

function isPublicApi(url: string): boolean {
  const pathOnly = url.split('?')[0];
  return PUBLIC_API.some((pattern) => pattern.test(pathOnly));
}

function isMutation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export async function buildApp() {
  await ensureDataDirs();
  await assertDbHealthy();

  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => cryptoRandomId(),
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试' },
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 6, fields: 12, parts: 20 },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    if (request.url.startsWith('/api') && isMutation(request.method)) {
      if (request.headers['sec-fetch-site'] === 'cross-site') {
        throw forbidden('跨站请求已被拦截');
      }
      const origin = request.headers.origin;
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          throw forbidden('请求来源不合法');
        }
        const allowedHosts = new Set([
          new URL(config.publicOrigin).host,
          request.headers.host ?? '',
        ]);
        if (!allowedHosts.has(originHost)) throw forbidden('请求来源不合法');
      }
    }
  });

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api')) return;
    if (isPublicApi(request.url)) return;
    const user = await resolveSession(request);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', '请先登录后再操作');
    }
    request.authUser = user;
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await assertDbHealthy();
      const worker = await one<{ last_seen_at: Date }>('SELECT last_seen_at FROM worker_heartbeat WHERE id = 1');
      const workerOnline = worker ? Date.now() - new Date(worker.last_seen_at).getTime() < 15_000 : false;
      return {
        data: {
          status: 'ok',
          database: 'ok',
          worker: workerOnline ? 'online' : 'offline',
          workerLastSeenAt: worker?.last_seen_at ?? null,
          time: new Date().toISOString(),
        },
      };
    } catch (error) {
      reply.code(503);
      return { data: { status: 'degraded', database: 'error', worker: 'unknown' } };
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as Error & { statusCode?: number; code?: string; validation?: unknown };
    if (fastifyError.validation) {
      const normalized = normalizeError(error);
      reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: '提交的数据格式不正确',
          details: normalized.details,
          requestId: request.id,
        },
      };
    }
    if (fastifyError.statusCode === 429 || fastifyError.code === 'FST_ERR_RATE_LIMIT') {
      reply.code(429);
      return { error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试', requestId: request.id } };
    }
    const normalized = normalizeError(error);
    if (normalized.statusCode >= 500) {
      request.log.error({ err: error }, '未处理的服务端错误');
      if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
        reply.code(413);
        return { error: { code: 'FILE_TOO_LARGE', message: '文件超过 12MB 上限', requestId: request.id } };
      }
    }
    reply.code(normalized.statusCode);
    return {
      error: {
        code: normalized.code,
        message: normalized.statusCode >= 500 && !normalized.code.startsWith('DIANPING_')
          ? '服务器开小差了，请稍后再试' : normalized.message,
        details: normalized.details,
        requestId: request.id,
      },
    };
  });


  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(inviteRoutes);
    await api.register(userRoutes);
    await api.register(taskRoutes);
    await api.register(promptRoutes);
    await api.register(poolRoutes);
    await api.register(miscRoutes);
    await api.register(statsRoutes);
    await api.register(dianpingRoutes);
  }, { prefix: '/api' });

  const indexPath = path.join(config.webDist, 'index.html');
  const assetsDir = path.join(config.webDist, 'assets');
  if (fs.existsSync(assetsDir)) {
    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: '/assets/',
      maxAge: config.isProduction ? '1y' : 0,
      immutable: config.isProduction,
    });
  }
  if (fs.existsSync(indexPath)) {
    const sendIndex = (_request: unknown, reply: { header: (key: string, value: string) => unknown; type: (value: string) => { send: (value: unknown) => unknown } }) => {
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html').send(fs.createReadStream(indexPath));
    };
    app.get('/', sendIndex);
    app.get('/index.html', sendIndex);
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: '接口不存在', requestId: request.id } };
    }
    if (request.method === 'GET' && fs.existsSync(indexPath) && !path.extname(request.url.split('?')[0])) {
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html').send(fs.createReadStream(indexPath));
    }
    reply.code(404);
    return { error: { code: 'NOT_FOUND', message: '页面不存在', requestId: request.id } };
  });


  app.addHook('onClose', async () => {
    // DB 由 index/worker 生命周期管理，此处只记录。
    logger.info('HTTP 服务已关闭');
  });

  return app;
}

function cryptoRandomId(): string {
  return randomUUID();
}
