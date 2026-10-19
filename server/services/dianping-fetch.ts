import { AppError } from '../lib/errors';
import type { DianpingCookie } from './dianping-cookies';

const PAGE_HOSTS = new Set(['dpurl.cn', 'm.dianping.com', 'www.dianping.com']);
const IMAGE_HOSTS = ['meituan.net', 'dpfile.com'];

export function cookieHeaderForUrl(cookies: DianpingCookie[], target: URL, now = Date.now()): string {
  return cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    const hostOnly = cookie.hostOnly ?? !cookie.domain.startsWith('.');
    const domainMatches = target.hostname === domain || (!hostOnly && target.hostname.endsWith('.' + domain));
    const pathname = cookie.path || '/';
    const pathMatches = target.pathname === pathname || (target.pathname.startsWith(pathname)
      && (pathname.endsWith('/') || target.pathname.charAt(pathname.length) === '/'));
    return domainMatches && pathMatches && (!cookie.secure || target.protocol === 'https:')
      && (cookie.expires === null || cookie.expires * 1000 > now);
  }).sort((a, b) => b.path.length - a.path.length)
    .map((cookie) => cookie.name + '=' + cookie.value).join('; ');
}

function allowedUrl(raw: string, media: boolean): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError(422, 'DIANPING_URL_INVALID', '解析链接无效'); }
  const allowed = media
    ? IMAGE_HOSTS.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))
    : PAGE_HOSTS.has(url.hostname);
  if (!allowed || url.username || url.password || url.port || !['http:', 'https:'].includes(url.protocol)
    || (media && url.protocol !== 'https:')) {
    throw new AppError(422, 'DIANPING_REDIRECT_INVALID', '笔记链接跳转到不支持的页面，请重新复制笔记分享链接');
  }
  return url;
}

async function limitedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new AppError(502, 'DIANPING_EMPTY_RESPONSE', '大众点评返回内容为空');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppError(413, 'DIANPING_RESPONSE_TOO_LARGE', '笔记内容超过大小限制，请改用手动上传');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  return Buffer.concat(chunks, size);
}

export async function fetchDianpingResource(raw: string, cookies: DianpingCookie[], media = false) {
  let url = allowedUrl(raw, media);
  if (url.protocol === 'http:') url.protocol = 'https:';
  const signal = AbortSignal.timeout(25_000);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      accept: media ? 'image/webp,image/*;q=0.9' : 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9',
      referer: 'https://m.dianping.com/',
    };
    const cookie = media ? '' : cookieHeaderForUrl(cookies, url);
    if (cookie) headers.cookie = cookie;
    let response: Response;
    try { response = await fetch(url, { headers, signal, redirect: 'manual' }); }
    catch { throw new AppError(502, 'DIANPING_NETWORK_ERROR', '暂时无法连接大众点评，请稍后重试'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new AppError(502, 'DIANPING_REDIRECT_INVALID', '大众点评跳转信息不完整');
      const next = new URL(location, url);
      if (!media && /passport|login|verify|captcha/i.test(next.hostname + next.pathname)) {
        throw new AppError(409, 'DIANPING_COOKIE_EXPIRED', '大众点评登录已失效或需要验证，请联系管理员更新 Cookie');
      }
      url = allowedUrl(next.toString(), media);
      if (url.protocol === 'http:') url.protocol = 'https:';
      continue;
    }
    if ([401, 403].includes(response.status)) {
      await response.body?.cancel();
      throw new AppError(409, 'DIANPING_COOKIE_EXPIRED', '大众点评拒绝访问，请联系管理员检查 Cookie 或完成登录验证');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(422, 'DIANPING_NOTE_UNAVAILABLE', '该笔记暂不可访问，请确认链接有效后重试');
    }
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase().trim();
    if (media && !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      await response.body?.cancel();
      throw new AppError(422, 'DIANPING_IMAGE_INVALID', '首图不是可用的图片格式');
    }
    const bytes = await limitedBody(response, media ? 12 * 1024 * 1024 : 4 * 1024 * 1024);
    return { bytes, mimeType, url: url.toString() };
  }
  throw new AppError(422, 'DIANPING_TOO_MANY_REDIRECTS', '笔记链接跳转次数过多，请重新复制分享链接');
}
