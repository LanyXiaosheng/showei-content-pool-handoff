import fs from 'node:fs/promises';
import path from 'node:path';
import { withTx, closeDb, q } from '../db';
import { logger } from '../lib/logger';

const INITIAL_VERSION = '001_initial_schema';
const OPTIONAL_TAGS_VERSION = '002_optional_task_tags';
const DIANPING_COOKIES_VERSION = '003_dianping_credentials';

export async function migrate(): Promise<void> {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const initial = await q<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = $1', [INITIAL_VERSION],
  );
  if (!initial.rows[0]) {
    const schema = await fs.readFile(path.join(__dirname, '../schema.sql'), 'utf8');
    await withTx(async (client) => {
      await client.query(schema);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [INITIAL_VERSION]);
    });
    logger.info(`数据库迁移完成：${INITIAL_VERSION}`);
  }

  const optionalTags = await q<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = $1', [OPTIONAL_TAGS_VERSION],
  );
  if (!optionalTags.rows[0]) {
    await withTx(async (client) => {
      await client.query('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_tags_check');
      await client.query("ALTER TABLE tasks ADD CONSTRAINT tasks_tags_check CHECK (jsonb_typeof(tags) = 'array')");
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [OPTIONAL_TAGS_VERSION]);
    });
    logger.info(`数据库迁移完成：${OPTIONAL_TAGS_VERSION}`);
  }

  const dianpingCookies = await q<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = $1', [DIANPING_COOKIES_VERSION],
  );
  if (!dianpingCookies.rows[0]) {
    await withTx(async (client) => {
      await client.query(`CREATE TABLE IF NOT EXISTS dianping_credentials (
        id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        cookies_ciphertext text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_checked_at timestamptz,
        last_check_ok boolean,
        last_check_message text
      )`);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [DIANPING_COOKIES_VERSION]);
    });
    logger.info(`数据库迁移完成：${DIANPING_COOKIES_VERSION}`);
  }
}

if (require.main === module) {
  migrate()
    .catch((error) => {
      logger.fatal({ err: error }, '数据库迁移失败');
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
