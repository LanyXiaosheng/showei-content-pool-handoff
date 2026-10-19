import { buildApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { closeDb } from './db';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.isProduction ? '0.0.0.0' : '127.0.0.1' });
  logger.info(
    {
      port: config.port,
      publicOrigin: config.publicOrigin,
      mode: config.nodeEnv,
      demoMode: config.demoMode,
    },
    `拾味内容中台 API 已启动: http://localhost:${config.port}`,
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, '收到退出信号，正在优雅关闭');
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  logger.fatal({ err: error }, 'API 启动失败');
  await closeDb().catch(() => undefined);
  process.exit(1);
});
