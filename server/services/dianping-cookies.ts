import { one, q } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { dianpingCookieCounts, parseDianpingCookies, type DianpingCookie } from './dianping-cookie-format';

export { type DianpingCookie, parseDianpingCookies, usableDianpingCookies } from './dianping-cookie-format';

interface CookieRow {
  cookies_ciphertext: string | null;
  version: number;
  updated_at: Date;
  last_checked_at: Date | null;
  last_check_ok: boolean | null;
  last_check_message: string | null;
}

function decryptCookies(ciphertext: string): DianpingCookie[] {
  try { return JSON.parse(decryptSecret(ciphertext)) as DianpingCookie[]; }
  catch { throw new AppError(503, 'DIANPING_COOKIE_UNREADABLE', '大众点评 Cookie 无法读取，请联系管理员重新导入'); }
}

export async function loadDianpingCredential(): Promise<{ cookies: DianpingCookie[]; version: number } | null> {
  const row = await one<CookieRow>('SELECT * FROM dianping_credentials WHERE id = 1');
  return row?.cookies_ciphertext ? { cookies: decryptCookies(row.cookies_ciphertext), version: row.version } : null;
}

export async function getDianpingCookieSummary() {
  const row = await one<CookieRow>('SELECT * FROM dianping_credentials WHERE id = 1');
  const cookies = row?.cookies_ciphertext ? decryptCookies(row.cookies_ciphertext) : [];
  return {
    configured: Boolean(row?.cookies_ciphertext),
    ...dianpingCookieCounts(cookies),
    updatedAt: row?.updated_at?.toISOString() ?? null,
    lastCheckedAt: row?.last_checked_at?.toISOString() ?? null,
    lastCheckOk: row?.last_check_ok ?? null,
    lastCheckMessage: row?.last_check_message ?? null,
  };
}

export async function saveDianpingCookies(actorId: string, cookieJson: string) {
  // Validate the entire replacement before writing, preserving the old credential on failure.
  const cookies = parseDianpingCookies(cookieJson);
  const ciphertext = encryptSecret(JSON.stringify(cookies));
  await q(`INSERT INTO dianping_credentials (id, cookies_ciphertext, updated_by)
    VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET cookies_ciphertext = EXCLUDED.cookies_ciphertext,
      version = dianping_credentials.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now(),
      last_checked_at = NULL, last_check_ok = NULL, last_check_message = NULL`, [ciphertext, actorId]);
  return getDianpingCookieSummary();
}

export async function clearDianpingCookies(actorId: string) {
  // Keep a tombstone so a delayed check can never match a later replacement's version.
  await q(`INSERT INTO dianping_credentials (id, cookies_ciphertext, updated_by)
    VALUES (1, NULL, $1)
    ON CONFLICT (id) DO UPDATE SET cookies_ciphertext = NULL, version = dianping_credentials.version + 1,
      updated_by = EXCLUDED.updated_by, updated_at = now(),
      last_checked_at = NULL, last_check_ok = NULL, last_check_message = NULL`, [actorId]);
  return getDianpingCookieSummary();
}

export async function recordDianpingCheck(version: number, ok: boolean, _message: string): Promise<void> {
  // Persist only our own fixed text, never upstream bodies, URLs, or credential values.
  const message = ok ? '已成功解析笔记，Cookie 可用' : '解析失败，请检查链接、Cookie 或大众点评访问验证';
  await q(`UPDATE dianping_credentials SET last_checked_at = now(), last_check_ok = $2,
    last_check_message = $3 WHERE id = 1 AND version = $1 AND cookies_ciphertext IS NOT NULL`,
  [version, ok, message]);
}
