import { config } from '../config';
import { AppError, badRequest } from '../lib/errors';
import { loadDianpingCredential, recordDianpingCheck, usableDianpingCookies } from './dianping-cookies';
import { fetchDianpingResource } from './dianping-fetch';
import { parseDianpingPage } from './dianping-page';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_HOSTS = ['meituan.net', 'dpfile.com'];

interface ParserPayload {
  succ?: boolean;
  retcode?: number;
  retdesc?: string;
  data?: {
    platform?: string;
    title?: string;
    desc?: string;
    tags?: unknown;
    cover_url?: string;
  };
}

export interface DianpingImport {
  title: string;
  body: string;
  tags: string[];
  coverBase64: string;
  coverMimeType: string;
  sourceUrl: string;
}

function isAllowedImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
      && IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function extractDianpingUrl(text: string): string {
  const candidates = text.match(/https?:\/\/[^\s，。；、]+/gi) ?? [];
  for (const candidate of candidates) {
    const raw = candidate.replace(/[，。；、,;!！?？）)\]】]+$/g, '');
    try {
      const url = new URL(raw);
      const isShort = url.hostname === 'dpurl.cn' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
      const isPost = url.hostname === 'm.dianping.com' && /^\/feeddetail\/\d+\/?$/.test(url.pathname);
      if (['http:', 'https:'].includes(url.protocol)
        && !url.username && !url.password && !url.port && (isShort || isPost)) {
        url.hash = '';
        return url.toString();
      }
    } catch { /* skip malformed URL */ }
  }
  throw badRequest('请粘贴大众点评笔记或 dpurl.cn 分享链接');
}

function parserBase(): string {
  const raw = config.dianpingParserApiUrl;
  if (!raw) throw new AppError(503, 'DIANPING_PARSER_UNCONFIGURED', '大众点评解析服务尚未配置');
  try {
    const url = new URL(raw);
    const local = ['127.0.0.1', 'localhost', 'host.docker.internal'].includes(url.hostname);
    if (!url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (local && url.protocol === 'http:'))
      && url.pathname.endsWith('/api/v1')) return url.toString().replace(/\/$/, '');
  } catch { /* invalid server configuration */ }
  throw new AppError(503, 'DIANPING_PARSER_UNCONFIGURED', '大众点评解析服务地址无效');
}

async function fetchCover(base: string, sourceUrl: string): Promise<{ base64: string; mimeType: string }> {
  if (!isAllowedImage(sourceUrl)) throw new AppError(502, 'DIANPING_IMAGE_INVALID', '解析结果的首图地址无效');
  const mediaUrl = `${base}/media?url=${encodeURIComponent(sourceUrl)}&filename=dianping-cover.jpg`;
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(25_000), redirect: 'manual' });
  if (!response.ok || !response.body) throw new AppError(502, 'DIANPING_IMAGE_FAILED', '首图暂时无法下载');
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    await response.body.cancel();
    throw new AppError(502, 'DIANPING_IMAGE_INVALID', '首图不是可用的图片格式');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new AppError(413, 'DIANPING_IMAGE_TOO_LARGE', '首图超过 12MB，请手动上传图片');
    }
    chunks.push(Buffer.from(value));
  }
  if (!size) throw new AppError(502, 'DIANPING_IMAGE_FAILED', '首图内容为空');
  return { base64: Buffer.concat(chunks, size).toString('base64'), mimeType };
}

async function importLegacyDianping(text: string): Promise<DianpingImport> {
  const sourceUrl = extractDianpingUrl(text);
  const base = parserBase();
  let response: Response;
  try {
    response = await fetch(`${base}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
      signal: AbortSignal.timeout(25_000),
      redirect: 'manual',
    });
  } catch {
    throw new AppError(502, 'DIANPING_PARSER_UNAVAILABLE', '解析服务不可用，请联系管理员导入大众点评 Cookie');
  }
  let payload: ParserPayload;
  try {
    payload = await response.json() as ParserPayload;
  } catch {
    throw new AppError(502, 'DIANPING_PARSER_INVALID', '解析服务返回了无效数据');
  }
  if (!response.ok || payload.succ === false || payload.retcode !== 200) {
    throw new AppError(502, 'DIANPING_PARSE_FAILED', '大众点评解析失败，请联系管理员检查登录状态');
  }
  const data = payload.data;
  const title = data?.title?.trim() ?? '';
  const body = data?.desc?.trim() ?? '';
  const tags = Array.isArray(data?.tags)
    ? [...new Set(data.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.replace(/^#+/, '').trim())
      .filter((tag) => tag.length > 0 && tag.length <= 120 && !tag.startsWith('@')))].slice(0, 12)
    : [];
  const coverUrl = data?.cover_url ?? '';
  if (data?.platform !== '大众点评' || title.length < 3 || title.length > 200
    || body.length > 8000 || !coverUrl) {
    throw new AppError(502, 'DIANPING_CONTENT_INCOMPLETE', '解析结果缺少标题或首图');
  }
  try {
    const cover = await fetchCover(base, coverUrl);
    return { title, body, tags, coverBase64: cover.base64, coverMimeType: cover.mimeType, sourceUrl };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'DIANPING_IMAGE_FAILED', '首图暂时无法下载');
  }
}

interface ImportDependencies {
  loadCredential?: typeof loadDianpingCredential;
  recordCheck?: typeof recordDianpingCheck;
}

export async function importDianping(text: string, dependencies: ImportDependencies = {}): Promise<DianpingImport> {
  const sourceUrl = extractDianpingUrl(text);
  const credential = await (dependencies.loadCredential ?? loadDianpingCredential)();
  if (!credential) {
    if (config.dianpingParserApiUrl) return importLegacyDianping(text);
    throw new AppError(409, 'DIANPING_COOKIE_MISSING', '请联系管理员在 API 接入页导入大众点评 Cookie');
  }
  const record = dependencies.recordCheck ?? recordDianpingCheck;
  try {
    const cookies = usableDianpingCookies(credential.cookies);
    if (!cookies.length) throw new AppError(409, 'DIANPING_COOKIE_EXPIRED', '大众点评 Cookie 已过期，请联系管理员重新导入');
    const page = await fetchDianpingResource(sourceUrl, cookies);
    const note = parseDianpingPage(page.bytes.toString('utf8'), page.url);
    const cover = await fetchDianpingResource(note.coverUrl, [], true);
    if (!cover.bytes.length) throw new AppError(502, 'DIANPING_IMAGE_FAILED', '首图内容为空');
    await record(credential.version, true, '解析成功');
    return { title: note.title, body: note.body, tags: note.tags, coverBase64: cover.bytes.toString('base64'),
      coverMimeType: cover.mimeType, sourceUrl };
  } catch (error) {
    await record(credential.version, false, '解析失败').catch(() => undefined);
    throw error;
  }
}
