import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DianpingCookie } from './dianping-cookies';
import { cookieHeaderForUrl, fetchDianpingResource } from './dianping-fetch';

const jar: DianpingCookie[] = [
  { name: 'session', value: 'fixture-session', domain: 'dianping.com', hostOnly: false, path: '/', secure: true, expires: null },
  { name: 'private', value: 'fixture-private', domain: 'www.dianping.com', hostOnly: true, path: '/', secure: false, expires: null },
  { name: 'pathOnly', value: 'fixture-path', domain: 'm.dianping.com', hostOnly: true, path: '/feed', secure: true, expires: null },
  { name: 'old', value: 'fixture-old', domain: 'dianping.com', hostOnly: false, path: '/', secure: true, expires: 1 },
];

test('Cookie只发给匹配域名、路径、协议与有效期的请求', () => {
  assert.equal(cookieHeaderForUrl(jar, new URL('https://m.dianping.com/feeddetail/123')), 'session=fixture-session');
  assert.equal(cookieHeaderForUrl(jar, new URL('http://m.dianping.com/feeddetail/123')), '');
  assert.equal(cookieHeaderForUrl(jar, new URL('https://m.dianping.com/feed/123')), 'pathOnly=fixture-path; session=fixture-session');
  assert.equal(cookieHeaderForUrl(jar, new URL('https://evildianping.com/')), '');
  assert.equal(cookieHeaderForUrl(jar, new URL('https://dpurl.cn/abc')), '');
});

test('短链逐跳重新选择Cookie，不向短链域泄露大众点评会话', async () => {
  const fetch = globalThis.fetch;
  const seen: Array<{ url: string; cookie: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    seen.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
    return seen.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://m.dianping.com/feeddetail/123?bizType=1' } })
      : new Response('<html>page</html>', { headers: { 'content-type': 'text/html' } });
  };
  try {
    const result = await fetchDianpingResource('https://dpurl.cn/abc', jar);
    assert.match(result.url, /bizType=1/);
    assert.equal(seen[0].cookie, null);
    assert.equal(seen[1].cookie, 'session=fixture-session');
  } finally { globalThis.fetch = fetch; }
});

test('外站重定向被拦截且不发起第二次请求', async () => {
  const fetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'https://evil.example/collect' } }); };
  try {
    await assert.rejects(fetchDianpingResource('https://dpurl.cn/abc', jar), { code: 'DIANPING_REDIRECT_INVALID' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = fetch; }
});

test('图片请求不包含Cookie，非图片响应不可作为首图', async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('cookie'), null);
    return new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } });
  };
  try { await assert.rejects(fetchDianpingResource('https://p1.meituan.net/a.jpg', jar, true), { code: 'DIANPING_IMAGE_INVALID' }); }
  finally { globalThis.fetch = fetch; }
});

test('登录跳转和HTTP403给出Cookie维护提示', async () => {
  const fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://m.dianping.com/feeddetail/login-redirect?redir=x' } });
    await assert.rejects(fetchDianpingResource('https://m.dianping.com/feeddetail/123', jar), { code: 'DIANPING_COOKIE_EXPIRED' });
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(fetchDianpingResource('https://m.dianping.com/feeddetail/123', jar), { code: 'DIANPING_COOKIE_EXPIRED' });
  } finally { globalThis.fetch = fetch; }
});

test('重定向无法将共享Cookie降级发送到HTTP', async () => {
  const fetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    assert.ok(String(input).startsWith('https://'));
    return calls === 1
      ? new Response(null, { status: 302, headers: { location: 'http://m.dianping.com/feeddetail/123' } })
      : new Response('page');
  };
  try { await fetchDianpingResource('https://m.dianping.com/feeddetail/123', jar.map((cookie) => ({ ...cookie, secure: false }))); }
  finally { globalThis.fetch = fetch; }
  assert.equal(calls, 2);
});
