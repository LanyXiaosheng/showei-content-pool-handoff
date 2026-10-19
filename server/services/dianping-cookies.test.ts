import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../lib/errors';
import {
  dianpingCookieCounts, MAX_COOKIE_JSON_BYTES, parseDianpingCookies,
} from './dianping-cookie-format';

const NOW = 1_800_000_000;
const sample = { name: 'session', value: 'private-token', domain: '.dianping.com', path: '/', secure: true };
const parse = (rows: unknown) => parseDianpingCookies(JSON.stringify(rows), NOW);

test('JSON 格式错误和结构错误不会回显凭据内容', () => {
  for (const input of ['private-token{', '{}', '[]', '{"cookies":"private-token"}']) {
    assert.throws(() => parseDianpingCookies(input, NOW), (error: unknown) =>
      error instanceof AppError && error.statusCode === 400 && !error.message.includes('private-token'));
  }
});

test('支持浏览器 Cookie 数组及 storageState，保留 hostOnly 语义', () => {
  const cookies = parse({ cookies: [sample, { ...sample, name: 'other', domain: 'm.dianping.com' }] });
  assert.equal(cookies[0].domain, 'dianping.com');
  assert.equal(cookies[0].hostOnly, false);
  assert.equal(cookies[1].hostOnly, true);
  assert.equal(parse([{ ...sample, hostOnly: true }])[0].hostOnly, true);
  assert.equal(parse([{ ...sample, domain: 'M.DIANPING.COM', hostOnly: false }])[0].hostOnly, false);
});

test('域名严格匹配边界，忽略浏览器其他网站 Cookie', () => {
  const cookies = parse([
    sample,
    { ...sample, domain: '.dpurl.cn' },
    { ...sample, domain: 'evil-dianping.com' },
    { ...sample, domain: 'dianping.com.evil.test' },
    { ...sample, domain: 'evil.test', value: 'unrelated;invalid' },
    { ...sample, domain: 'dianping.com\r\nHost: evil.test' },
  ]);
  assert.deepEqual(cookies.map((cookie) => cookie.domain), ['dianping.com', 'dpurl.cn']);
  assert.throws(() => parse([{ ...sample, domain: 'dianping.com.evil.test' }]), /没有大众点评/);
});

test('Cookie 名称和值拒绝请求头注入与 Cookie 拼接', () => {
  for (const value of ['ok; injected=yes', 'ok\r\nHost: evil.test', 'a,b', '"abc"', 'abc\\def', 'a b']) {
    assert.throws(() => parse([{ ...sample, value }]), /不支持的字符/);
  }
  for (const name of ['a=b', 'name; value', 'name\r\n']) {
    assert.throws(() => parse([{ ...sample, name }]), /不支持的字符/);
  }
  assert.equal(parse([{ ...sample, value: '' }])[0].value, '');
  assert.throws(() => parse([{ ...sample, path: '/\r\n' }]), /路径/);
});

test('秒级有效期、会话 Cookie、全部过期校验', () => {
  const cookies = parse([
    { ...sample, name: 'expired-analytics', expires: NOW - 1 },
    { ...sample, name: 'auth', expirationDate: NOW + 100 },
    { ...sample, name: 'session', expires: -1 },
  ]);
  assert.equal(cookies[1].expires, NOW + 100);
  assert.equal(cookies[2].expires, null);
  assert.deepEqual(dianpingCookieCounts(cookies, NOW), { cookieCount: 3, usableCookieCount: 2, expiresAt: null });
  assert.throws(() => parse([{ ...sample, expires: NOW }]), /全部过期/);
  assert.throws(() => parse([{ ...sample, expires: 'tomorrow' }]), /有效期/);
  const persistent = parse([{ ...sample, expires: NOW + 10 }, { ...sample, name: 'b', expires: NOW + 20 }]);
  assert.equal(dianpingCookieCounts(persistent, NOW).expiresAt, new Date((NOW + 20) * 1000).toISOString());
});

test('按域名、路径、名称覆盖重复条目，大小限制采用 UTF-8 字节', () => {
  const cookies = parse([sample, { ...sample, value: 'replacement' }, { ...sample, path: '/note' }]);
  assert.equal(cookies.length, 2);
  assert.equal(cookies[0].value, 'replacement');
  assert.throws(() => parse([sample, { ...sample, expires: NOW - 1 }]), /全部过期/);
  assert.throws(() => parseDianpingCookies('中'.repeat(MAX_COOKIE_JSON_BYTES / 2), NOW), /512 KiB/);
});

test('无效替换在任何数据库写入前拒绝', async () => {
  process.env.DATABASE_URL ??= 'postgresql://127.0.0.1:1/cookie-test-no-database';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const { saveDianpingCookies } = await import('./dianping-cookies');
  for (const input of ['not-json', JSON.stringify([{ ...sample, expires: 1 }])]) {
    await assert.rejects(saveDianpingCookies('test-actor', input), (error: unknown) =>
      error instanceof AppError && error.statusCode === 400);
  }
});

test('所有维护接口拒绝普通用户，管理员无效输入在数据库访问前拒绝', async () => {
  const { default: Fastify } = await import('fastify');
  const { dianpingRoutes } = await import('../routes/dianping');
  const { normalizeError } = await import('../lib/errors');
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.authUser = { id: 'test-actor', role: request.headers['x-test-role'] === 'ADMIN' ? 'ADMIN' : 'USER' } as never;
  });
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply.code(normalized.statusCode).send({ error: normalized });
  });
  await app.register(dianpingRoutes);
  try {
    for (const method of ['GET', 'PUT', 'DELETE', 'POST'] as const) {
      const response = await app.inject({
        method, url: `/admin/dianping-cookie${method === 'POST' ? '/test' : ''}`,
        ...(method === 'PUT' ? { payload: { cookieJson: 'sensitive-invalid-json' } } : {}),
        ...(method === 'POST' ? { payload: { text: 'https://m.dianping.com/feeddetail/1' } } : {}),
      });
      assert.equal(response.statusCode, 403);
      assert.ok(!response.body.includes('sensitive-invalid-json'));
    }
    const invalid = await app.inject({
      method: 'PUT', url: '/admin/dianping-cookie', headers: { 'x-test-role': 'ADMIN' },
      payload: { cookieJson: 'sensitive-invalid-json' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.ok(!invalid.body.includes('sensitive-invalid-json'));
  } finally { await app.close(); }
});
