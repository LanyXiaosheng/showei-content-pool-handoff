'use strict';

// Run inside the API container. Only an independently created temporary database is changed.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const TEMP_DATABASE = /^shiwei_cookie_test_[0-9]+_[0-9]+$/;
let phase = 'initialization';

function check(condition, message) {
  // Never hand assert the actual response, Cookie value, ciphertext, or credentials.
  assert.ok(Boolean(condition), message);
}

async function parent() {
  phase = 'temporary database setup';
  check(Boolean(process.env.DATABASE_URL), 'DATABASE_URL is required');
  const connection = new URL(process.env.DATABASE_URL);
  const databaseName = `shiwei_cookie_test_${process.pid}_${Date.now()}`;
  check(TEMP_DATABASE.test(databaseName), 'temporary database name rejected');
  const client = new Client({ connectionString: connection.toString() });
  let created = false;
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    connection.pathname = `/${databaseName}`;
    phase = 'isolated integration child';
    const result = spawnSync(process.execPath, [__filename, '--child'], {
      env: {
        ...process.env,
        DATABASE_URL: connection.toString(),
        SHIWEI_COOKIE_TEST_DB: databaseName,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        PUBLIC_ORIGIN: 'http://cookie-test.local',
        DIANPING_PARSER_API_URL: '',
      },
      cwd: '/app',
      encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Deliberately omit raw stderr and arbitrary child output on failures.
    for (const line of (result.stdout || '').split('\n')) {
      if (/^PASS: [A-Za-z0-9 ,./_-]+$/.test(line)) process.stdout.write(`${line}\n`);
    }
    for (const line of (result.stderr || '').split('\n')) {
      if (/^FAIL: Cookie integration during [A-Za-z -]+$/.test(line)) process.stderr.write(`${line}\n`);
    }
    check(!result.error && result.status === 0, 'isolated integration child failed');
  } finally {
    try {
      if (created) {
        phase = 'temporary database cleanup';
        check(TEMP_DATABASE.test(databaseName), 'refusing unsafe database cleanup');
        check(connection.pathname === `/${databaseName}`, 'database cleanup identity mismatch');
        await client.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        process.stdout.write('PASS: temporary database removed\n');
      }
    } finally { await client.end(); }
  }
}

async function child() {
  phase = 'child database identity check';
  const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
  check(TEMP_DATABASE.test(databaseName), 'child requires a temporary test database');
  check(databaseName === process.env.SHIWEI_COOKIE_TEST_DB, 'child database identity mismatch');
  check(process.env.NODE_ENV === 'test' && process.env.LOG_LEVEL === 'silent', 'test environment required');
  const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), `${databaseName}-`));
  process.env.DATA_DIR = temporaryData;
  const { q, closeDb } = require('/app/dist/server/db.js');
  const { hashPassword, decryptSecret } = require('/app/dist/server/lib/crypto.js');
  const { recordDianpingCheck } = require('/app/dist/server/services/dianping-cookies.js');
  let app;
  const originalFetch = globalThis.fetch;
  const secrets = [randomBytes(20).toString('hex'), randomBytes(20).toString('hex')];
  let currentSecret = secrets[0];
  let pageRequests = 0;
  let imageRequests = 0;
  const noSecrets = (text) => check(secrets.every((secret) => !String(text).includes(secret)), 'secret exposure detected');
  const credentialRow = async () => (await q('SELECT * FROM dianping_credentials WHERE id = 1')).rows[0];
  const cookiePayload = (value, extra = {}) => ({ cookieJson: JSON.stringify([
    { name: 'dper', value, domain: '.dianping.com', path: '/', secure: true, expires: -1, ...extra },
  ]) });
  try {
    check((await q('SELECT current_database() AS name')).rows[0].name === databaseName, 'connected database mismatch');
    phase = 'database migration and fixture setup';
    await require('/app/dist/server/cli/migrate.js').migrate();
    const migration = await q('SELECT version FROM schema_migrations WHERE version = $1', ['003_dianping_credentials']);
    check(migration.rowCount === 1, 'Cookie migration was not applied');
    const password = randomBytes(12).toString('hex') + 'Aa1!';
    const passwordHash = await hashPassword(password);
    for (const role of ['ADMIN', 'AGENT', 'USER']) {
      await q(`INSERT INTO users (email, password_hash, display_name, role)
        VALUES ($1, $2, $3, $4)`, [`${role.toLowerCase()}@cookie-test.local`, passwordHash, `Cookie Test ${role}`, role]);
    }
    app = await require('/app/dist/server/app.js').buildApp();
    const api = async (method, url, cookie, payload) => {
      const response = await app.inject({
        method, url,
        headers: { origin: 'http://cookie-test.local', ...(cookie ? { cookie } : {}) },
        ...(payload === undefined ? {} : { payload }),
      });
      noSecrets(response.body);
      return response;
    };
    const sessions = {};
    for (const role of ['ADMIN', 'AGENT', 'USER']) {
      const response = await api('POST', '/api/auth/login', null, {
        email: `${role.toLowerCase()}@cookie-test.local`, password,
      });
      check(response.statusCode === 200, 'fixture login failed');
      const session = response.cookies.find((cookie) => cookie.name === 'shiwei_session');
      check(Boolean(session?.value), 'fixture session missing');
      sessions[role] = `${session.name}=${session.value}`;
    }
    const maintenance = '/api/admin/dianping-cookie';
    const noteText = { text: 'https://m.dianping.com/feeddetail/3498219284' };
    phase = 'maintenance authorization';
    for (const role of [null, 'USER', 'AGENT']) {
      const expected = role === null ? 401 : 403;
      for (const [method, suffix, payload] of [
        ['GET', '', undefined], ['PUT', '', cookiePayload(secrets[0])],
        ['DELETE', '', undefined], ['POST', '/test', noteText],
      ]) {
        const response = await api(method, maintenance + suffix, role ? sessions[role] : null, payload);
        check(response.statusCode === expected, 'maintenance permission check failed');
      }
    }
    process.stdout.write('PASS: anonymous USER and AGENT authorization\n');

    phase = 'encrypted Cookie import';
    const initial = await api('PUT', maintenance, sessions.ADMIN, cookiePayload(secrets[0]));
    check(initial.statusCode === 200, 'administrator import failed');
    const summary = initial.json().data;
    check(summary.configured && summary.cookieCount === 1 && summary.usableCookieCount === 1, 'summary incorrect');
    check(!('cookies' in summary) && !('cookieJson' in summary) && !('cookies_ciphertext' in summary), 'summary exposes secrets');
    const first = await credentialRow();
    check(first.cookies_ciphertext.startsWith('v1.'), 'credential not encrypted');
    noSecrets(first.cookies_ciphertext);
    const decrypted = JSON.parse(decryptSecret(first.cookies_ciphertext));
    check(decrypted.length === 1 && decrypted[0].value === secrets[0], 'encrypted credential cannot be read');
    check(decrypted[0].domain === 'dianping.com' && decrypted[0].hostOnly === false, 'domain normalization failed');

    phase = 'invalid replacement preservation';
    for (const payload of [
      { cookieJson: '{' + secrets[0] },
      cookiePayload(secrets[1], { expires: 1 }),
      cookiePayload(secrets[1], { domain: 'dianping.com.invalid.test' }),
      cookiePayload(secrets[1] + '; injected=yes'),
    ]) {
      const rejected = await api('PUT', maintenance, sessions.ADMIN, payload);
      check(rejected.statusCode === 400, 'invalid replacement was accepted');
      const retained = await credentialRow();
      check(retained.version === first.version && retained.cookies_ciphertext === first.cookies_ciphertext,
        'invalid replacement changed stored credential');
    }
    process.stdout.write('PASS: encrypted import and invalid replacement preservation\n');

    phase = 'database-backed shared parsing';
    const jpeg = await require('sharp')({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg().toBuffer();
    const title = '隔离数据库解析验证笔记';
    const html = '<script type="application/ld+json">' + JSON.stringify({
      '@type': 'SocialMediaPosting', headline: title, articleBody: '口味清爽，份量足。#美食探店',
      image: ['https://p1.meituan.net/ugcpic/cookie-integration.jpg'],
    }) + '</script>';
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      const headers = new Headers(options?.headers);
      if (url.hostname === 'm.dianping.com') {
        check(headers.get('cookie') === `dper=${currentSecret}`, 'parser did not use the current database credential');
        pageRequests += 1;
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      check(url.hostname === 'p1.meituan.net', 'unexpected external request');
      check(!headers.has('cookie'), 'image request received the credential');
      imageRequests += 1;
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    };
    const adminTest = await api('POST', maintenance + '/test', sessions.ADMIN, noteText);
    check(adminTest.statusCode === 200 && adminTest.json().data.ok === true, 'administrator parse test failed');
    check(adminTest.json().data.title === title, 'administrator parse result incorrect');
    const userParse = await api('POST', '/api/imports/dianping', sessions.USER, noteText);
    check(userParse.statusCode === 200 && userParse.json().data.title === title, 'shared user parsing failed');
    check(userParse.json().data.coverMimeType === 'image/jpeg', 'cover result incorrect');
    check(pageRequests === 2 && imageRequests === 2, 'unexpected parse request count');
    check((await credentialRow()).last_check_ok === true, 'parse success was not recorded');

    phase = 'replacement freshness and stale check rejection';
    currentSecret = secrets[1];
    const replacement = await api('PUT', maintenance, sessions.ADMIN, cookiePayload(secrets[1]));
    check(replacement.statusCode === 200, 'replacement failed');
    const second = await credentialRow();
    check(second.version > first.version && second.last_checked_at === null, 'replacement version incorrect');
    await recordDianpingCheck(first.version, false, secrets[0]);
    check((await credentialRow()).last_checked_at === null, 'stale check polluted new configuration');
    const freshParse = await api('POST', '/api/imports/dianping', sessions.USER, noteText);
    check(freshParse.statusCode === 200 && freshParse.json().data.title === title, 'replacement needs a restart');
    check(pageRequests === 3 && imageRequests === 3, 'replacement was not used by the parser');
    await recordDianpingCheck(second.version, true, secrets[1]);
    const checked = await credentialRow();
    noSecrets(checked.last_check_message);
    check(checked.last_check_ok === true, 'current version check was not saved');
    process.stdout.write('PASS: administrator test shared parsing and live Cookie replacement\n');

    phase = 'clear tombstone and audit checks';
    const cleared = await api('DELETE', maintenance, sessions.ADMIN);
    check(cleared.statusCode === 200 && cleared.json().data.configured === false, 'Cookie clear failed');
    const tombstone = await credentialRow();
    check(tombstone.cookies_ciphertext === null && tombstone.version > second.version, 'clear version incorrect');
    await recordDianpingCheck(second.version, false, secrets[1]);
    check((await credentialRow()).last_checked_at === null, 'stale check polluted cleared configuration');
    const missing = await api('POST', '/api/imports/dianping', sessions.USER, noteText);
    check(missing.statusCode === 409, 'parsing after clear did not request administrator configuration');
    const finalSummary = await api('GET', maintenance, sessions.ADMIN);
    check(finalSummary.statusCode === 200 && !finalSummary.json().data.configured, 'final summary incorrect');
    const audit = await q('SELECT action, meta FROM audit_logs');
    noSecrets(JSON.stringify(audit.rows));
    check(audit.rows.some((row) => row.action === 'DIANPING_COOKIE_SAVED'), 'save audit missing');
    check(audit.rows.some((row) => row.action === 'DIANPING_COOKIE_CLEARED'), 'clear audit missing');
    check(Number((await q('SELECT count(*) AS total FROM tasks')).rows[0].total) === 0, 'parsing created a task');
    process.stdout.write('PASS: version guards clear audit redaction and zero task side effects\n');
  } finally {
    globalThis.fetch = originalFetch;
    try { if (app) await app.close(); }
    finally {
      try { await closeDb(); }
      finally {
        check(path.dirname(temporaryData) === os.tmpdir()
          && path.basename(temporaryData).startsWith(`${databaseName}-`), 'unsafe temporary directory cleanup');
        fs.rmSync(temporaryData, { recursive: true, force: true });
      }
    }
  }
}

(process.argv[2] === '--child' ? child() : parent()).catch(() => {
  // Keep database URLs, request bodies, session tokens, and assertion values out of failure output.
  process.stderr.write(`FAIL: Cookie integration during ${phase}\n`);
  process.exitCode = 1;
});
