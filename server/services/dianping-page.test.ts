import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDianpingPage } from './dianping-page';

process.env.DATABASE_URL ??= 'postgresql://127.0.0.1:5433/test';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');

const article = '<script type="application/ld+json">' + JSON.stringify({
  '@type': 'SocialMediaPosting', headline: '餐厅新菜试吃记录', articleBody: '口味清爽，份量足。#美食探店',
  image: ['https://p1.meituan.net/ugcpic/fixture.jpg'],
}) + '</script>';

test('结构化笔记提取标题正文首图和去重话题', () => {
  const result = parseDianpingPage(article);
  assert.equal(result.title, '餐厅新菜试吃记录');
  assert.equal(result.body, '口味清爽，份量足。#美食探店');
  assert.deepEqual(result.tags, ['美食探店']);
  assert.equal(result.coverUrl, 'https://p1.meituan.net/ugcpic/fixture.jpg');
});

test('提取独立话题集合与标签对象字段，忽略评论、推荐和正文块结构', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'SocialMediaPosting', id: '123', headline: '周末餐厅体验记录',
    articleBody: '味道不错，值得再来。#正文话题',
    image: ['https://p1.meituan.net/ugcpic/fixture.jpg'],
    topicTags: { items: [
      { tagName: '#页面话题' }, { name: '页面话题' }, { title: '  #环境不错  ' }, { text: '@不应导入' },
    ] },
    hashtags: ['＃性价比高', { name: '服务周到' }],
    comments: [{ text: '评论里的#评论话题' }],
    recommendations: [{ hashtags: ['#推荐话题'] }],
    contentBlocks: [{ text: '#正文结构误识别' }],
  }) + '</script>';
  const result = parseDianpingPage(html, 'https://m.dianping.com/feeddetail/123');
  assert.deepEqual(result.tags, ['页面话题', '环境不错', '性价比高', '服务周到', '正文话题']);
});

test('标签对象容器只读取标签名字段并清理前缀、重复及@项', () => {
  const html = '<script type="application/json">' + JSON.stringify({
    noteId: '123', noteTitle: '周末餐厅体验记录', noteContent: '现场体验记录',
    imageList: ['https://p1.meituan.net/ugcpic/fixture.jpg'],
    tagList: { data: [{ name: '##招牌菜' }, { text: '氛围舒适' }, { name: '@账号' }, { label: '不支持的通用字段' }] },
  }) + '</script>';
  const result = parseDianpingPage(html, 'https://m.dianping.com/feeddetail/123');
  assert.deepEqual(result.tags, ['招牌菜', '氛围舒适']);
});

test('Qwik对象引用按base36解码，数字字符串叶值不会再次解引用且循环安全', () => {
  const data = { objs: [
    { noteTitle: '1', noteContent: '2', imageList: '3', noteId: '5', cycle: '6' },
    '店里吃饭尝鲜记录', '10', ['4'], 'https://p1.meituan.net/ugcpic/fixture.jpg', '3498219284', { self: '6' },
  ] };
  const html = '<script type="qwik/json">' + JSON.stringify(data) + '</script>';
  const result = parseDianpingPage(html, 'https://m.dianping.com/feeddetail/3498219284');
  assert.equal(result.body, '10');
  assert.equal(result.title, '店里吃饭尝鲜记录');
});

test('HTTP200登录页、品牌页、恶意图片都不会被当成笔记', () => {
  assert.throws(() => parseDianpingPage('<html q:route="feeddetail/login-redirect"><title>大众点评</title></html>'),
    { code: 'DIANPING_COOKIE_EXPIRED' });
  assert.throws(() => parseDianpingPage('<meta property="og:title" content="大众点评"><meta property="og:image" content="https://p1.meituan.net/logo.jpg">'),
    { code: 'DIANPING_CONTENT_INCOMPLETE' });
  assert.throws(() => parseDianpingPage(article.replace('p1.meituan.net', 'meituan.net.evil.example')),
    { code: 'DIANPING_CONTENT_INCOMPLETE' });
});

test('标准OG与HTML转义受支持，JSON脚本中的代码不会执行', () => {
  const html = '<meta property="og:title" content="周末探店 &amp; 新菜"><meta property="og:image" content="https://p1.meituan.net/a.jpg">'
    + '<meta name="description" content="午餐体验"><script type="application/json">globalThis.__shouldNotRun = true</script>';
  assert.equal(parseDianpingPage(html).title, '周末探店 & 新菜');
  assert.equal((globalThis as Record<string, unknown>).__shouldNotRun, undefined);
});

test('目标笔记消失时不会导入推荐笔记，短链跳到首页也不会判定成功', () => {
  const html = '<script type="application/json">' + JSON.stringify({ recommendations: [{
    noteId: '999', noteTitle: '其他推荐笔记', noteContent: '其他内容', imageList: ['https://p1.meituan.net/a.jpg'],
  }] }) + '</script>';
  assert.throws(() => parseDianpingPage(html, 'https://m.dianping.com/feeddetail/123'),
    { code: 'DIANPING_CONTENT_INCOMPLETE' });
  assert.throws(() => parseDianpingPage(article, 'https://m.dianping.com/'),
    { code: 'DIANPING_NOTE_UNAVAILABLE' });
  assert.throws(() => parseDianpingPage(article, 'https://m.dianping.com/?redir=/feeddetail/123'),
    { code: 'DIANPING_NOTE_UNAVAILABLE' });
});

test('每次解析使用新版本数据库Cookie，首图请求不携带Cookie', async () => {
  const { importDianping } = await import('./dianping');
  const original = globalThis.fetch; const sent: string[] = []; const checks: number[] = [];
  let version = 0;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (String(input).startsWith('https://m.dianping.com/')) {
      sent.push(headers.get('cookie') || ''); return new Response(article, { headers: { 'content-type': 'text/html' } });
    }
    assert.equal(headers.get('cookie'), null);
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
  };
  const dependencies = {
    loadCredential: async () => {
      version += 1;
      return { version, cookies: [{ name: 'dper', value: 'fixture-v' + version, domain: 'dianping.com',
        hostOnly: false, path: '/', secure: true, expires: null }] };
    },
    recordCheck: async (v: number, ok: boolean) => { assert.ok(ok); checks.push(v); },
  };
  try {
    for (let i = 0; i < 2; i += 1) {
      const result = await importDianping('https://m.dianping.com/feeddetail/3498219284?bizType=1', dependencies);
      assert.equal(result.title, '餐厅新菜试吃记录');
      assert.equal(result.coverBase64, '/9j/');
    }
    assert.deepEqual(sent, ['dper=fixture-v1', 'dper=fixture-v2']);
    assert.deepEqual(checks, [1, 2]);
  } finally { globalThis.fetch = original; }
});
