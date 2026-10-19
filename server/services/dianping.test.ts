import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://127.0.0.1:5433/test';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.DIANPING_PARSER_API_URL = 'http://127.0.0.1:8051/api/v1';

test('只接受大众点评笔记或短链，不接收第三方 URL', async () => {
  const { extractDianpingUrl } = await import('./dianping');
  assert.equal(extractDianpingUrl('分享 http://dpurl.cn/I6XoFc4z。'), 'http://dpurl.cn/I6XoFc4z');
  const postUrl = 'https://m.dianping.com/feeddetail/530178352?sceneType=0';
  assert.equal(extractDianpingUrl(postUrl), postUrl);
  const shareText = '看到环宇城新开了虎跳，我就立马来吃了醋炒蛋 '
    + 'https://m.dianping.com/feeddetail/3498219284?sceneType=0&bizType=1&utm_source=ugcshare\u00a0';
  assert.equal(
    extractDianpingUrl(shareText),
    'https://m.dianping.com/feeddetail/3498219284?sceneType=0&bizType=1&utm_source=ugcshare',
  );
  assert.throws(() => extractDianpingUrl('https://evil.example/feeddetail/530178352'));
  assert.throws(() => extractDianpingUrl('http://127.0.0.1/private'));
});

test('解析标题正文首图并从受信任的媒体代理读取图片', async () => {
  const { importDianping } = await import('./dianping');
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    if (requests.length === 1) return new Response(JSON.stringify({
      succ: true,
      retcode: 200,
      data: {
        platform: '大众点评',
        title: '测试餐厅笔记',
        desc: '这是包含真实菜品体验与环境描述的完整正文。',
        tags: ['#美食探店', '秋天断层好吃的美食餐厅', '#美食探店', '@点小二'],
        cover_url: 'https://p1.meituan.net/ugcpic/test.jpg',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const result = await importDianping('http://dpurl.cn/I6XoFc4z');
    assert.equal(result.title, '测试餐厅笔记');
    assert.deepEqual(result.tags, ['美食探店', '秋天断层好吃的美食餐厅']);
    assert.equal(result.coverMimeType, 'image/jpeg');
    assert.equal(result.coverBase64, '/9j/');
    assert.equal(requests.length, 2);
    assert.match(requests[1], /\/api\/v1\/media\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('无正文和话题标签的图片笔记仍可导入', async () => {
  const { importDianping } = await import('./dianping');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({
      succ: true,
      retcode: 200,
      data: { platform: '大众点评', title: '只有图片的笔记', cover_url: 'https://p1.meituan.net/ugcpic/test.jpg' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const result = await importDianping('http://dpurl.cn/I6XoFc4z');
    assert.equal(result.body, '');
    assert.deepEqual(result.tags, []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('正文和原始标签为空时，文案生成仍可使用卖点与默认标签库', async () => {
  const { buildMockCopy } = await import('./copywriting');
  const { DEFAULT_COPY_PROMPT } = await import('../defaults');
  const context = {
    task: {
      id: 'test-task',
      task_no: 'T-OPTIONAL-1',
      source_title: '虎跳醋炒蛋探店',
      source_body: '',
      selling_points: ['醋炒蛋口味清爽，小朋友也喜欢'],
      tags: [],
    },
    prompt: DEFAULT_COPY_PROMPT,
    groupNo: 1,
    attempt: 1,
  } as Parameters<typeof buildMockCopy>[0];
  const copy = buildMockCopy(context);
  assert.ok(copy.body.length > 0);
  assert.ok(copy.tags.length >= 4);
});
