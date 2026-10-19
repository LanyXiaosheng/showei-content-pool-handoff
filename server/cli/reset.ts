import { closeDb, q } from '../db';
import { logger } from '../lib/logger';
import { migrate } from './migrate';

async function main(): Promise<void> {
  if (process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('拒绝执行：仅在显式设置 ALLOW_DB_RESET=true 时允许清空数据库');
  }
  logger.warn('正在清空 public schema……');
  await q('DROP SCHEMA public CASCADE');
  await q('CREATE SCHEMA public');
  await migrate();
  logger.info('数据库已重置');
}

main()
  .catch((error) => {
    logger.fatal({ err: error }, '数据库重置失败');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
