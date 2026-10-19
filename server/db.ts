import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from './config';
import { logger } from './lib/logger';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'Postgres 连接池发生错误');
});

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const started = Date.now();
  const result = await pool.query<T>(text, params as never[]);
  const duration = Date.now() - started;
  if (duration > 800) {
    logger.warn({ duration, rows: result.rowCount, sql: text.slice(0, 100) }, '慢查询');
  }
  return result;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await q<T>(text, params);
  return result.rows[0] ?? null;
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, '事务回滚失败');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function assertDbHealthy(): Promise<void> {
  await pool.query('select 1');
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
