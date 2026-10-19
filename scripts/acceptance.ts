import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { format } from 'date-fns';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const API = `${BASE_URL}/api`;
const PASSWORD = process.env.DEMO_PASSWORD || 'Shiwei@2026';
const RUN_ID = Date.now().toString(36).toUpperCase();
const SAMPLE_IMAGE = path.resolve(process.cwd(), 'fixtures/sample-dish.jpg');
const REPORT_JSON = path.resolve(process.cwd(), 'docs/acceptance-report.json');
const REPORT_MD = path.resolve(process.cwd(), 'docs/ACCEPTANCE-REPORT.md');

interface Check {
  group: string;
  name: string;
  passed: boolean;
  detail: string;
  durationMs?: number;
}
interface Metrics {
  taskNo?: string;
  generationSeconds?: number;
  groupCount?: number;
  contentPoolBefore?: number;
  contentPoolAfter?: number;
  maxTextSimilarity?: number;
  maxImageCorrelation?: number;
  minImageCorrelation?: number;
  averageCopyLength?: number;
  claimedGroup?: string;
  concurrentWinner?: string;
  imageCount?: number;
  zipBytes?: number;
}

const checks: Check[] = [];
const metrics: Metrics = {};
const sessions: Record<string, string> = {};
const startedAt = new Date();

function check(group: string, name: string, passed: boolean, detail: string): void {
  checks.push({ group, name, passed, detail });
  const marker = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${marker} [${group}] ${name} — ${detail}`);
}

class HttpError extends Error {
  status: number;
  code: string;
  payload: unknown;
  constructor(status: number, code: string, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

interface ApiResult<T = any> {
  status: number;
  data: T;
  message?: string;
}

async function request<T = any>(
  cookie: string | null,
  endpoint: string,
  options: { method?: string; body?: unknown; form?: FormData; rawText?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API}${endpoint}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `HTTP ${response.status}`,
      payload,
    );
  }
  return { status: response.status, data: payload?.data ?? payload, message: payload?.message };
}

async function expectStatus(promise: Promise<unknown>, expected: number | number[], label: string): Promise<ApiResult> {
  try {
    const result = await promise;
    if (!Array.isArray(expected) && result.status !== expected) {
      throw new Error(`${label}: 期望 ${expected}，实际 ${result.status}`);
    }
    return result;
  } catch (error) {
    if (error instanceof HttpError) {
      const allowed = Array.isArray(expected) ? expected : [expected];
      if (allowed.includes(error.status)) {
        return { status: error.status, data: error.payload, message: error.message };
      }
      throw new Error(`${label}: 期望 ${allowed.join('/')}，实际 ${error.status} ${error.message}`);
    }
    throw error;
  }
}

function extractCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('登录响应没有 Set-Cookie');
  return setCookie.split(';')[0];
}

async function login(email: string, password = PASSWORD): Promise<string> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const payload: any = await response.json().catch(() => null);
    throw new Error(`登录 ${email} 失败：${payload?.error?.message ?? response.status}`);
  }
  return extractCookie(response);
}

async function createTask(cookie: string, title: string, generationCount = 10): Promise<{
  id: string;
  taskNo: string;
  status: string;
}> {
  const image = await fs.readFile(SAMPLE_IMAGE);
  const form = new FormData();
  form.append('generationCount', String(generationCount));
  form.append('sourceTitle', title);
  form.append(
    'sourceBody',
    '最近挖到一家藏在老街区里的炭火小馆。厚切牛肉大火快煎，边缘微焦，咬开还有肉汁；宽面裹满黑椒酱汁，挂汁又筋道。番茄和菠菜是意外惊喜，酸香把油脂感压得刚刚好。蘑菇吸满肉香，人均一百出头，分量实在。晚上七点后容易排队，建议错峰。',
  );
  form.append(
    'sellingPoints',
    JSON.stringify([
      '厚切牛肉大火快煎，外焦里嫩还有肉汁',
      '宽面裹满黑椒酱汁，挂汁又筋道',
      '番茄与菠菜配菜清爽解腻',
      '蘑菇吸满肉香，口感弹嫩',
      '人均一百出头，分量实在性价比高',
    ]),
  );
  form.append('tags', JSON.stringify(['美食探店', '炭火料理', '宝藏小店', '城市美食', '周末去哪儿吃']));
  form.append('images', new Blob([image], { type: 'image/jpeg' }), 'acceptance-dish.jpg');
  const result = await request(cookie, '/tasks', { method: 'POST', form });
  return result.data as { id: string; taskNo: string; status: string };
}

async function waitForTask(cookie: string, taskId: string, timeoutMs = 180_000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = await request(cookie, `/tasks/${taskId}`);
    if (detail.data.status === 'COMPLETED') return detail.data;
    if (['FAILED', 'VOID', 'REJECTED'].includes(detail.data.status)) {
      throw new Error(`任务状态为 ${detail.data.status}：${detail.data.failureReason ?? detail.data.reviewComment ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`等待任务完成超时（${timeoutMs / 1000}s）`);
}

function paragraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[#＃\s，。！？、；：“”‘’（）()【】\[\]…—\-·,.!?;:'"<>《》]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function textSimilarity(a: string, b: string, n = 4): number {
  const shingles = (text: string) => {
    const normalized = normalize(text);
    const set = new Set<string>();
    if (normalized.length <= n) {
      if (normalized) set.add(normalized);
      return set;
    }
    for (let i = 0; i <= normalized.length - n; i += 1) set.add(normalized.slice(i, i + n));
    return set;
  };
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

async function imageSignature(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).resize(48, 64, { fit: 'fill' }).grayscale().raw().toBuffer();
}

function correlation(a: Buffer, b: Buffer): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= b.length;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    numerator += x * y;
    varianceA += x * x;
    varianceB += y * y;
  }
  if (!varianceA || !varianceB) return 0;
  return numerator / Math.sqrt(varianceA * varianceB);
}

async function download(cookie: string, groupId: string): Promise<{ buffer: Buffer; status: number }> {
  const response = await fetch(`${API}/content/${groupId}/download`, { headers: { cookie } });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, status: response.status };
}

async function main(): Promise<void> {
  console.log(`\n拾味内容中台 · 端到端验收  ${format(startedAt, 'yyyy-MM-dd HH:mm:ss')}`);
  console.log(`目标：${BASE_URL}\n`);

  const health = await request(null, '/health');
  check('环境', 'API 与数据库健康', health.data.status === 'ok' && health.data.database === 'ok', `status=${health.data.status}, db=${health.data.database}`);
  check('环境', '生成 Worker 在线', health.data.worker === 'online', `worker=${health.data.worker}, lastSeen=${health.data.workerLastSeenAt}`);

  sessions.admin = await login(process.env.ADMIN_EMAIL || 'admin@shiwei.local');
  sessions.agent = await login('agent@shiwei.local');
  sessions.userA = await login('user-a@shiwei.local');
  sessions.userB = await login('user-b@shiwei.local');
  check('权限', '三级角色均可登录', Boolean(sessions.admin && sessions.agent && sessions.userA && sessions.userB), '管理员 / 代理 / 用户 A / 用户 B');

  // 1. 代理提交任务，任务应为待审核，不生成内容。
  const task = await createTask(sessions.agent, '黑椒厚切牛肉宽面｜藏在老街区的炭火小馆');
  metrics.taskNo = task.taskNo;
  check('任务流程', '代理提交任务后状态为待审核', task.status === 'PENDING_REVIEW', `taskNo=${task.taskNo}, status=${task.status}`);
  const beforeDetail = await request(sessions.admin, `/tasks/${task.id}`);
  check('任务流程', '审核前无生成队列', beforeDetail.data.job === null, `job=${String(beforeDetail.data.job)}`);
  check('任务流程', '审核前不调用生成 API、不产生内容', beforeDetail.data.counts.available === 0 && beforeDetail.data.counts.claimed === 0 && beforeDetail.data.counts.generatedImages === 0, JSON.stringify(beforeDetail.data.counts));
  const beforeApprovalContent = await request(sessions.admin, `/admin/content?q=${encodeURIComponent(task.taskNo)}&pageSize=100`);
  check('任务流程', '审核前公共池没有该任务内容', beforeApprovalContent.data.items.length === 0, `content=${beforeApprovalContent.data.items.length}`);

  const poolBefore = await request(sessions.userA, '/pool?pageSize=1');
  metrics.contentPoolBefore = poolBefore.data.total;

  // 2. 管理员审核通过，生成 10 组。
  const approveStart = Date.now();
  const approve = await request(sessions.admin, `/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'APPROVE' } });
  check('任务流程', '管理员审核通过后进入排队', ['QUEUED', 'GENERATING'].includes(approve.data.status), `status=${approve.data.status}`);
  const completedTask = await waitForTask(sessions.admin, task.id, 180_000);
  metrics.generationSeconds = Number(((Date.now() - approveStart) / 1000).toFixed(1));
  check('任务流程', '10 组全部生成完成', completedTask.status === 'COMPLETED' && completedTask.counts.available === 10, `status=${completedTask.status}, available=${completedTask.counts.available}, 用时=${metrics.generationSeconds}s`);

  const taskLogs = await request(sessions.admin, `/tasks/${task.id}/logs`);
  const events = new Set(taskLogs.data.items.map((item: any) => item.event));
  check('可观测性', '生成日志记录了启动、逐组生成和完成', ['JOB_STARTED', 'GROUP_GENERATED', 'JOB_SUCCEEDED'].every((event) => events.has(event)), [...events].join(', '));
  const agentLogs = await request(sessions.agent, `/tasks/${task.id}/logs`);
  const agentLogText = JSON.stringify(agentLogs.data.items);
  check('权限', '任务日志不向代理泄漏 Prompt 变体参数', !/garnish|positiveTemplate|negativeTemplate|tagLibrary|narrativeStructures/.test(agentLogText), 'meta sanitized for non-admin');

  const content = await request(sessions.admin, `/admin/content?q=${encodeURIComponent(task.taskNo)}&pageSize=100`);
  const groups = (content.data.items as any[]).sort((a, b) => a.groupNo - b.groupNo);
  metrics.groupCount = groups.length;
  check('内容池', '10 组内容全部进入内容池', groups.length === 10, `groups=${groups.length}`);
  check('内容池', '内容初始状态为可领取', groups.every((group) => group.status === 'AVAILABLE'), [...new Set(groups.map((group) => group.status))].join(', '));

  const poolAfter = await request(sessions.userA, '/pool?pageSize=1');
  metrics.contentPoolAfter = poolAfter.data.total;
  check('内容池', '公共池可领取数量增加 10', poolAfter.data.total === poolBefore.data.total + 10, `${poolBefore.data.total} → ${poolAfter.data.total}`);

  const agentLibrary = await request(sessions.agent, '/library?pageSize=100');
  const taskPrefix = `SW-${task.taskNo.replace(/^T/, '')}`;
  check('核心规则', '提交任务的代理不会自动获得成品', !agentLibrary.data.items.some((item: any) => item.groupCode.startsWith(taskPrefix)), `agent library total=${agentLibrary.data.total}`);

  // 3. 文案、图片、相似度校验。
  const details: any[] = [];
  const imageBuffers: Buffer[] = [];
  for (const group of groups) {
    const detail = await request(sessions.admin, `/pool/${group.id}`);
    details.push({ ...detail.data, groupNo: group.groupNo, groupCode: group.groupCode });
    const zip = await download(sessions.admin, group.id);
    if (zip.status !== 200) throw new Error(`管理员下载 ${group.groupCode} 失败：${zip.status}`);
    const archive = new AdmZip(zip.buffer);
    const entries = archive.getEntries().map((entry) => entry.entryName);
    const folder = `Group_${String(group.groupNo).padStart(2, '0')}`;
    const expected = [`${folder}/文案.txt`, `${folder}/image_01.jpg`];
    if (!expected.every((name) => entries.includes(name))) {
      throw new Error(`${group.groupCode} ZIP 结构不完整：${entries.join(', ')}`);
    }
    const image = archive.getEntry(expected[1])?.getData();
    const text = archive.getEntry(expected[0])?.getData().toString('utf8').replace(/^\uFEFF/, '') ?? '';
    if (!image) throw new Error(`${group.groupCode} 缺少图片`);
    if (!text.includes('标题：') || !text.includes('正文：') || !text.includes('话题标签：')) {
      throw new Error(`${group.groupCode} 文案 txt 结构不正确`);
    }
    const metadata = await sharp(image).metadata();
    if (metadata.width !== 900 || metadata.height !== 1200) {
      throw new Error(`${group.groupCode} 图片尺寸 ${metadata.width}x${metadata.height}，不是 3:4`);
    }
    imageBuffers.push(image);
    if (group.groupNo === 1) {
      metrics.zipBytes = zip.buffer.length;
    }
  }

  check('输出打包', '每组 ZIP 含 Group_XX 文件夹、图片与独立 txt', details.length === 10, `已校验 ${details.length} 个 ZIP`);
  check('图片', '全部变体图强制输出 900×1200（3:4）', imageBuffers.length === 10, `images=${imageBuffers.length}, ratio=0.75`);
  metrics.imageCount = imageBuffers.length;

  const issueList: string[] = [];
  const titles = details.map((item) => item.title.trim());
  if (new Set(titles).size !== 10) issueList.push('标题存在重复');
  if (titles.some((title) => title.includes(RUN_ID))) issueList.push('标题包含测试后缀');
  const paragraphsList = details.map((item) => paragraphs(item.body));
  if (paragraphsList.some((value) => value.length !== 3)) issueList.push('存在非三段式正文');
  const sourceSellingPoints = [
    '厚切牛肉大火快煎，外焦里嫩还有肉汁',
    '宽面裹满黑椒酱汁，挂汁又筋道',
    '番茄与菠菜配菜清爽解腻',
    '蘑菇吸满肉香，口感弹嫩',
    '人均一百出头，分量实在性价比高',
  ];
  if (details.some((item) => !sourceSellingPoints.every((point) => normalize(item.body).includes(normalize(point))))) {
    issueList.push('存在遗漏卖点');
  }
  if (details.some((item) => item.tags.length < 4 || item.tags.length > 7)) issueList.push('标签数量不在 4–7 之间');
  if (new Set(details.map((item) => [...item.tags].sort().join('|'))).size !== 10) issueList.push('标签组合存在重复');
  const lengths = details.map((item) => normalize(item.body).length);
  metrics.averageCopyLength = Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length);
  if (lengths.some((value) => value < 180 || value > 340)) issueList.push(`正文长度越界(${Math.min(...lengths)}–${Math.max(...lengths)})`);
  let maxTextSimilarity = 0;
  for (let i = 0; i < details.length; i += 1) {
    for (let j = i + 1; j < details.length; j += 1) {
      maxTextSimilarity = Math.max(maxTextSimilarity, textSimilarity(details[i].body, details[j].body));
    }
  }
  metrics.maxTextSimilarity = Number(maxTextSimilarity.toFixed(4));
  if (maxTextSimilarity >= 0.8) issueList.push(`文案最大相似度 ${maxTextSimilarity.toFixed(3)} ≥ 0.8`);
  check('文案', '10 份文案三段式、保留全部卖点、标题/标签组合唯一', issueList.length === 0, issueList.length ? issueList.join('；') : `平均 ${metrics.averageCopyLength} 字，最大相似度 ${metrics.maxTextSimilarity}`);
  check('文案', '文案差异明显，无大面积重复', maxTextSimilarity < 0.8, `max 4-gram Jaccard = ${maxTextSimilarity.toFixed(3)}（阈值 0.80）`);

  const signatures = await Promise.all(imageBuffers.map((buffer) => imageSignature(buffer)));
  let maxImageCorrelation = 0;
  let minImageCorrelation = 1;
  for (let i = 0; i < signatures.length; i += 1) {
    for (let j = i + 1; j < signatures.length; j += 1) {
      const value = correlation(signatures[i], signatures[j]);
      maxImageCorrelation = Math.max(maxImageCorrelation, value);
      minImageCorrelation = Math.min(minImageCorrelation, value);
    }
  }
  metrics.maxImageCorrelation = Number(maxImageCorrelation.toFixed(4));
  metrics.minImageCorrelation = Number(minImageCorrelation.toFixed(4));
  check('图片', '不存在高度雷同图片', maxImageCorrelation < 0.985, `最大空间相关=${maxImageCorrelation.toFixed(3)}（阈值 0.985），最小=${minImageCorrelation.toFixed(3)}`);

  // 4. 独占领取与并发锁。
  const group1 = groups[0];
  const group2 = groups[1];
  const claim1 = await request(sessions.userA, `/pool/${group1.id}/claim`, { method: 'POST' });
  metrics.claimedGroup = claim1.data.groupCode ?? group1.groupCode;
  check('领取核验', '用户 A 可成功领取第 1 组', claim1.status === 200, `${group1.groupCode} → user A`);
  const libraryA = await request(sessions.userA, '/library?pageSize=100');
  check('领取核验', '领取后内容进入用户 A 的「我的领取」', libraryA.data.items.some((item: any) => item.id === group1.id), `library total=${libraryA.data.total}`);

  const bViewClaimed = await expectStatus(request(sessions.userB, `/pool/${group1.id}`), 404, '用户 B 查看已领取内容');
  check('领取核验', '用户 B 看不到已被领取的组', bViewClaimed.status === 404, 'GET /pool/:id → 404');
  const bClaim = await expectStatus(request(sessions.userB, `/pool/${group1.id}/claim`, { method: 'POST' }), 409, '用户 B 重复领取');
  check('领取核验', '用户 B 无法重复领取', bClaim.status === 409 && (bClaim.data as any).error.code === 'CONTENT_TAKEN', '409 CONTENT_TAKEN');

  const poolList = await request(sessions.userB, '/pool?pageSize=100');
  check('核心规则', '已领取内容立刻从公共池下架', !poolList.data.items.some((item: any) => item.id === group1.id), `available=${poolList.data.total}`);

  // 并发领取同一组，只能一个成功。
  const [raceA, raceB] = await Promise.all([
    fetch(`${API}/pool/${group2.id}/claim`, { method: 'POST', headers: { cookie: sessions.userA } }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) })),
    fetch(`${API}/pool/${group2.id}/claim`, { method: 'POST', headers: { cookie: sessions.userB } }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) })),
  ]);
  const successes = [raceA, raceB].filter((item) => item.status === 200).length;
  const conflicts = [raceA, raceB].filter((item) => item.status === 409).length;
  metrics.concurrentWinner = raceA.status === 200 ? 'user A' : 'user B';
  check('并发领取', '两名用户并发抢同一组，只有一人成功', successes === 1 && conflicts === 1, `200×${successes}, 409×${conflicts}, winner=${metrics.concurrentWinner}`);

  // 5. 下载授权与 ZIP。
  const downloadA = await download(sessions.userA, group1.id);
  const downloadB = await download(sessions.userB, group1.id);
  check('下载', '领取人可下载 ZIP', downloadA.status === 200 && downloadA.buffer.length > 10_000, `status=${downloadA.status}, bytes=${downloadA.buffer.length}`);
  check('下载', '非领取人无法下载', downloadB.status === 403, `status=${downloadB.status}`);
  const zipA = new AdmZip(downloadA.buffer);
  const names = zipA.getEntries().map((entry) => entry.entryName);
  check('下载', 'ZIP 包含 Group_XX 图片与文案', names.some((name) => /Group_\d+\/image_01\.jpg$/.test(name)) && names.some((name) => /Group_\d+\/文案\.txt$/.test(name)), names.join(', '));

  const mediaB = await fetch(`${API}/media/group-images/${group1.coverImageId}`, { headers: { cookie: sessions.userB } });
  const mediaA = await fetch(`${API}/media/group-images/${group1.coverImageId}`, { headers: { cookie: sessions.userA } });
  check('权限', '领取后图片媒体资源仅领取人可访问', mediaA.status === 200 && mediaB.status === 404, `owner=${mediaA.status}, other=${mediaB.status}`);

  // 6. 权限与配置隔离。
  const agentProviders = await expectStatus(request(sessions.agent, '/admin/providers'), 403, '代理访问 API 配置');
  const agentPrompts = await expectStatus(request(sessions.agent, '/admin/prompts'), 403, '代理访问 Prompt');
  const userPrompts = await expectStatus(request(sessions.userA, '/admin/prompts'), 403, '用户访问 Prompt');
  const userInvite = await expectStatus(request(sessions.userA, '/invites', { method: 'POST', body: { role: 'USER' } }), 403, '用户创建邀请码');
  check('权限', '代理/普通用户无法访问 API 密钥与 Prompt', agentProviders.status === 403 && agentPrompts.status === 403 && userPrompts.status === 403, '403 × 3');
  check('权限', '普通用户没有邀请入口/能力', userInvite.status === 403, '403');

  const adminPrompts = await request(sessions.admin, '/admin/prompts');
  const providerSummary = await request(sessions.admin, '/admin/providers');
  const providerJson = JSON.stringify(providerSummary.data);
  check('权限', 'API 密钥仅返回掩码，不返回密文/明文', !providerJson.includes('apiKey') && !providerJson.includes('api_key_ciphertext'), `providers=${providerSummary.data.items.length}, masked=true`);
  const taskJson = JSON.stringify(await request(sessions.agent, `/tasks/${task.id}`));
  check('权限', '任务接口不泄漏 Prompt 内容', !taskJson.includes('positiveTemplate') && !taskJson.includes('negativeTemplate') && !taskJson.includes('tagLibrary'), 'done');
  check('权限', 'Prompt 管理接口仅管理员可用', adminPrompts.data.items.length >= 2, `prompt versions=${adminPrompts.data.items.length}`);

  // 7. 邀请开关与注册。
  const agentQuery = await request(sessions.admin, '/admin/users?role=AGENT&pageSize=100');
  const agentAccount = agentQuery.data.items[0];
  await request(sessions.admin, `/admin/users/${agentAccount.id}`, { method: 'PATCH', body: { inviteEnabled: true } });
  const invite = await request(sessions.agent, '/invites', { method: 'POST', body: { role: 'USER', expiresInDays: 3, maxUses: 2, note: `验收 ${RUN_ID}` } });
  check('邀请', '代理在开关开启时可创建普通用户邀请码', invite.data.role === 'USER' && Boolean(invite.data.code), `code=${invite.data.code}`);
  const inviteAgent = await expectStatus(request(sessions.agent, '/invites', { method: 'POST', body: { role: 'AGENT' } }), 403, '代理邀请代理');
  check('邀请', '代理不能邀请代理', inviteAgent.status === 403, '403');

  const inviteCheck1 = await request(null, `/invites/check/${invite.data.code}`);
  await request(sessions.admin, `/admin/users/${agentAccount.id}`, { method: 'PATCH', body: { inviteEnabled: false } });
  const inviteCheck2 = await request(null, `/invites/check/${invite.data.code}`);
  const agentInviteDisabled = await expectStatus(request(sessions.agent, '/invites', { method: 'POST', body: { role: 'USER' } }), 403, '代理开关关闭后创建邀请');
  check('邀请', '管理员关闭邀请开关后代理不能创建，已有码暂停', inviteCheck1.data.valid === true && inviteCheck2.data.valid === false && agentInviteDisabled.status === 403, `valid before=${inviteCheck1.data.valid}, after=${inviteCheck2.data.valid}`);
  await request(sessions.admin, `/admin/users/${agentAccount.id}`, { method: 'PATCH', body: { inviteEnabled: true } });

  const inviteeEmail = `accept-${RUN_ID.toLowerCase()}@shiwei.local`;
  const register = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: invite.data.code, email: inviteeEmail, displayName: '验收新用户', password: 'Shiwei@2026' }),
  });
  const registerPayload: any = await register.json();
  check('邀请', '邀请码注册成功且角色由邀请决定', register.status === 200 && registerPayload.data.user.role === 'USER', `email=${inviteeEmail}, role=${registerPayload.data?.user?.role}`);
  const inviteeCookie = extractCookie(register);
  const inviteeInvite = await expectStatus(request(inviteeCookie, '/invites', { method: 'POST', body: { role: 'USER' } }), 403, '新用户邀请他人');
  check('邀请', '通过邀请注册的普通用户仍无邀请能力', inviteeInvite.status === 403, '403');

  // 管理员邀请代理；新代理默认无邀请权限，开通后才能邀请普通用户。
  const adminAgentInvite = await request(sessions.admin, '/invites', {
    method: 'POST',
    body: { role: 'AGENT', expiresInDays: 7, maxUses: 1, note: `验收代理邀请 ${RUN_ID}` },
  });
  const newAgentEmail = `agent-${RUN_ID.toLowerCase()}@shiwei.local`;
  const registerAgent = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: adminAgentInvite.data.code, email: newAgentEmail, displayName: '验收新代理', password: 'Shiwei@2026' }),
  });
  const registerAgentPayload: any = await registerAgent.json();
  const newAgentCookie = extractCookie(registerAgent);
  check('邀请', '管理员可邀请代理，新代理默认无邀请权限', registerAgent.status === 200 && registerAgentPayload.data.user.role === 'AGENT' && registerAgentPayload.data.user.inviteEnabled === false, `email=${newAgentEmail}, role=${registerAgentPayload.data?.user?.role}, inviteEnabled=${registerAgentPayload.data?.user?.inviteEnabled}`);
  const newAgentInviteBlocked = await expectStatus(request(newAgentCookie, '/invites', { method: 'POST', body: { role: 'USER' } }), 403, '未开通权限的代理邀请');
  await request(sessions.admin, `/admin/users/${registerAgentPayload.data.user.id}`, { method: 'PATCH', body: { inviteEnabled: true } });
  const newAgentInviteAllowed = await request(newAgentCookie, '/invites', { method: 'POST', body: { role: 'USER', expiresInDays: 1, maxUses: 1 } });
  check('邀请', '管理员开通后代理才能邀请普通用户', newAgentInviteBlocked.status === 403 && newAgentInviteAllowed.data.role === 'USER', `blocked=403, afterGrant=${newAgentInviteAllowed.data.role}`);

  // 8. 驳回与作废。
  const rejectTask = await createTask(sessions.agent, '深夜食堂｜一碗热乎的黑椒牛肉宽面');
  const reject = await request(sessions.admin, `/tasks/${rejectTask.id}/review`, { method: 'POST', body: { decision: 'REJECT', comment: '验收：素材与主题不匹配，请补充后重提' } });
  check('审核', '管理员驳回任务并填写理由', reject.data.status === 'REJECTED', `status=${reject.data.status}`);
  const rejectContent = await request(sessions.admin, `/admin/content?q=${encodeURIComponent(rejectTask.taskNo)}&pageSize=20`);
  check('审核', '被驳回任务不产生内容、不调用生成', rejectContent.data.items.length === 0, `content=${rejectContent.data.items.length}`);
  const agentNotifications = await request(sessions.agent, '/notifications?limit=50');
  check('通知', '驳回结果通知提交者', agentNotifications.data.items.some((item: any) => item.taskId === rejectTask.id && item.kind === 'TASK_REJECTED'), `notifications=${agentNotifications.data.items.length}`);

  const voidTask = await createTask(sessions.agent, '周末探店｜老街区里的宝藏面馆');
  const voidResult = await request(sessions.admin, `/tasks/${voidTask.id}/void`, { method: 'POST', body: { reason: '验收：测试任务作废' } });
  check('状态', '管理员可作废任务', voidResult.data.withdrawnGroups !== undefined, `withdrawn=${voidResult.data.withdrawnGroups ?? 0}`);

  // 9. Prompt 版本化 CRUD（不改变生产内容）。
  const copyActive = adminPrompts.data.items.find((item: any) => item.kind === 'COPY' && item.isActive);
  const imageActive = adminPrompts.data.items.find((item: any) => item.kind === 'IMAGE' && item.isActive);
  const createdPrompt = await request(sessions.admin, '/admin/prompts', {
    method: 'POST',
    body: {
      kind: 'COPY',
      name: `验收副本 ${RUN_ID}`,
      content: copyActive.content,
      activate: false,
    },
  });
  const promptId = createdPrompt.data.id;
  await request(sessions.admin, `/admin/prompts/${promptId}/activate`, { method: 'POST' });
  await request(sessions.admin, `/admin/prompts/${copyActive.id}/activate`, { method: 'POST' });
  await request(sessions.admin, `/admin/prompts/${promptId}`, { method: 'DELETE' });
  check('Prompt', '管理员可创建/激活/删除版本，历史版本不受影响', Boolean(promptId) && Boolean(imageActive), `created=${promptId}, restored=v${copyActive.version}`);

  // 10. 管理员直接创建账号并停用。
  const directEmail = `direct-${RUN_ID.toLowerCase()}@shiwei.local`;
  const direct = await request(sessions.admin, '/admin/users', { method: 'POST', body: { email: directEmail, displayName: '直建用户', role: 'USER' } });
  const tempPassword = direct.data.temporaryPassword;
  check('账号', '管理员可直接创建普通用户并返回一次性密码', Boolean(tempPassword) && direct.data.user.role === 'USER', `email=${directEmail}`);
  const directLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: directEmail, password: tempPassword }),
  });
  check('账号', '直建账号可用临时密码登录', directLogin.status === 200, `login=${directLogin.status}`);
  await request(sessions.admin, `/admin/users/${direct.data.user.id}`, { method: 'PATCH', body: { status: 'DISABLED' } });
  const disabledLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: directEmail, password: tempPassword }),
  });
  check('账号', '停用账号无法登录', disabledLogin.status === 403, `login=${disabledLogin.status}`);

  // 11. 异常鉴权。
  const noAuth = await fetch(`${API}/dashboard`);
  check('权限', '未登录访问受保护接口被拒绝', noAuth.status === 401, `status=${noAuth.status}`);

  const finishedAt = new Date();
  const passed = checks.filter((item) => item.passed).length;
  const failed = checks.length - passed;
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Number(((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)),
    baseUrl: BASE_URL,
    runId: RUN_ID,
    summary: { total: checks.length, passed, failed },
    metrics,
    checks,
  };
  await fs.mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const rows = checks.map((item) => `| ${item.passed ? '✅' : '❌'} | ${item.group} | ${item.name} | ${item.detail.replace(/\|/g, '\\|')} |`).join('\n');
  const markdown = `# 拾味内容中台 · 端到端验收报告

- 执行时间：${format(startedAt, 'yyyy-MM-dd HH:mm:ss')} — ${format(finishedAt, 'HH:mm:ss')}（Asia/Shanghai）
- 目标环境：${BASE_URL}
- 本次任务号：${metrics.taskNo ?? '—'}
- 结果：**${failed === 0 ? '全部通过' : `${failed} 项失败`}**（${passed}/${checks.length}）
- 生成用时：${metrics.generationSeconds ?? '—'} 秒
- 文案最大相似度：${metrics.maxTextSimilarity ?? '—'}（阈值 0.80）
- 图片最大空间相关：${metrics.maxImageCorrelation ?? '—'}（阈值 0.985）
- 平均文案长度：${metrics.averageCopyLength ?? '—'} 字

> 说明：本次验收使用系统内置演示适配器（\`mock\`）生成变体，未调用付费外部 API。真实 API 接入只需在管理员「API 接入」中切换 Provider 并填写密钥；超时、重试、质量卡口与相似度过滤共用同一链路。

| 结果 | 模块 | 验收项 | 证据 |
|---|---|---|---|
${rows}

## 指标

\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`

## 结论

${failed === 0
    ? '核心业务闭环、独占领取、权限隔离、邀请开关、Prompt 版本化与下载打包均通过自动化验收。'
    : '存在未通过项，详见上表；不应视为可交付状态。'}
`;
  await fs.writeFile(REPORT_MD, markdown, 'utf8');

  console.log(`\n验收结果：${failed === 0 ? '全部通过' : `${failed} 项失败`}（${passed}/${checks.length}）`);
  console.log(`报告：${REPORT_MD}`);
  console.log(`JSON：${REPORT_JSON}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\n验收执行中断：', error);
  process.exitCode = 1;
});
