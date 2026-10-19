import { migrate } from '../server/cli/migrate';
import { closeDb } from '../server/db';
import { logger } from '../server/lib/logger';

migrate()
  .catch((error) => {
    logger.fatal({ err: error }, '数据库迁移失败');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
