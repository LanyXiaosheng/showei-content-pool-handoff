import { badRequest } from '../lib/errors';

export const MAX_COOKIE_JSON_BYTES = 512 * 1024;

export interface DianpingCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  hostOnly?: boolean;
  expires: number | null;
}

function cookieDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.toLowerCase().replace(/^\./, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9-]+$/.test(domain)) return null;
  return ['dianping.com', 'dpurl.cn'].some((base) => domain === base || domain.endsWith(`.${base}`))
    ? domain : null;
}

function cookieExpiry(row: Record<string, unknown>): number | null {
  const value = row.expirationDate ?? row.expires;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 8.64e12) {
    throw badRequest('Cookie 有效期格式不正确');
  }
  return value < 0 ? null : value;
}

function normalizeCookie(value: unknown): DianpingCookie | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Cookie 条目格式不正确');
  const row = value as Record<string, unknown>;
  const domain = cookieDomain(row.domain);
  if (!domain) return null;
  if (typeof row.name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(row.name)
    || typeof row.value !== 'string' || /[\x00-\x20\x7f-\uffff;,"\\]/.test(row.value)) {
    throw badRequest('Cookie 名称或值包含不支持的字符');
  }
  const cookiePath = row.path ?? '/';
  if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || /[\x00-\x20\x7f]/.test(cookiePath)) {
    throw badRequest('Cookie 路径格式不正确');
  }
  if (row.secure !== undefined && typeof row.secure !== 'boolean') throw badRequest('Cookie secure 格式不正确');
  if (row.hostOnly !== undefined && typeof row.hostOnly !== 'boolean') throw badRequest('Cookie hostOnly 格式不正确');
  return {
    name: row.name, value: row.value, domain, path: cookiePath, secure: row.secure === true,
    hostOnly: typeof row.hostOnly === 'boolean' ? row.hostOnly : !(row.domain as string).startsWith('.'),
    expires: cookieExpiry(row),
  };
}

export function usableDianpingCookies(cookies: DianpingCookie[], nowSeconds = Date.now() / 1000): DianpingCookie[] {
  return cookies.filter((cookie) => cookie.expires === null || cookie.expires > nowSeconds);
}

export function parseDianpingCookies(cookieJson: string, nowSeconds = Date.now() / 1000): DianpingCookie[] {
  if (Buffer.byteLength(cookieJson, 'utf8') > MAX_COOKIE_JSON_BYTES) throw badRequest('Cookie JSON 不能超过 512 KiB');
  let parsed: unknown;
  try { parsed = JSON.parse(cookieJson); } catch { throw badRequest('Cookie JSON 格式不正确，请重新导出后导入'); }
  const rows = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).cookies : null;
  if (!Array.isArray(rows) || !rows.length) throw badRequest('请导入 Cookie 数组或包含 cookies 数组的 JSON');
  const unique = new Map<string, DianpingCookie>();
  for (const row of rows) {
    const cookie = normalizeCookie(row);
    if (cookie) unique.set(JSON.stringify([cookie.domain, cookie.path, cookie.name]), cookie);
  }
  const cookies = [...unique.values()];
  if (!cookies.length) throw badRequest('JSON 中没有大众点评或 dpurl.cn 的 Cookie');
  if (!usableDianpingCookies(cookies, nowSeconds).length) throw badRequest('Cookie 已全部过期，请登录大众点评重新导出');
  return cookies;
}

export function dianpingCookieCounts(cookies: DianpingCookie[], nowSeconds = Date.now() / 1000) {
  const usable = usableDianpingCookies(cookies, nowSeconds);
  // Session cookies have no known expiry; one expired analytics cookie cannot expire the whole login.
  const expiresAt = !usable.length || usable.some((cookie) => cookie.expires === null) ? null
    : new Date(Math.max(...usable.map((cookie) => cookie.expires!)) * 1000).toISOString();
  return { cookieCount: cookies.length, usableCookieCount: usable.length, expiresAt };
}
