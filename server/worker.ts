import os from 'node:os';
import { config } from './config';
import { closeDb } from './db';
import { logger } from './lib/logger';
import { ensureDataDirs } from './services/storage';
import {
  claimNextJob,
  heartbeat,
  processGenerationJob,
  recoverStaleJobs,
} from './services/generation';

const workerId = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const startedAt = new Date();
let stopping = false;
let lastRecovery = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(): Promise<void> {
  await ensureDataDirs();
  logger.info({ workerId, pollMs: config.workerPollMs }, '生成 Worker 已启动');
  while (!stopping) {
    try {
      await heartbeat(workerId, startedAt);
      if (Date.now() - lastRecovery > 30_000) {
        await recoverStaleJobs();
        lastRecovery = Date.now();
      }
      const claimed = await claimNextJob(workerId);
      if (!claimed) {
        await sleep(config.workerPollMs);
        continue;
      }
      logger.info({ workerId, jobId: claimed.job.id, taskNo: claimed.task.task_no }, '领取到生成任务');
      const result = await processGenerationJob(claimed);
      logger.info({ workerId, jobId: claimed.job.id, result }, '生成任务处理结束');
    } catch (error) {
      logger.error({ err: error, workerId }, 'Worker 轮询异常');
      await sleep(1500);
    }
  }
  logger.info({ workerId }, '生成 Worker 已停止');
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ workerId, signal }, '收到退出信号，等待当前任务结束');
  setTimeout(() => {
    logger.error({ workerId }, 'Worker 优雅退出超时，强制结束');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void loop()
  .catch((error) => {
    logger.fatal({ err: error }, 'Worker 启动失败');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    process.exit();
  });
