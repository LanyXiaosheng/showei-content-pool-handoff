import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, q, withTx } from '../db';
import { config } from '../config';
import { logger } from '../lib/logger';
import { createNotification, writeAudit } from './audit';
import { generateCopyWithProvider, generateImageWithProvider } from './providers';
import { validateCopyAgainstTask } from './copywriting';
import { normalizeForSimilarity } from './imageProcessing';
import { removeGroupFolder, resolveDataPath, saveGeneratedImage } from './storage';
import type {
  CopyVariant,
  GenerateVariants,
  JobRow,
  PromptSnapshot,
  TaskImageRow,
  TaskRow,
} from '../types';
import { imageCorrelation, textSimilarity as copySimilarity, type ValidatedImage } from './imageProcessing';

class CancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'CancelledError';
  }
}

interface ClaimedJob {
  job: JobRow;
  task: TaskRow;
}

interface ExistingGroup {
  id: string;
  group_no: number;
  title: string;
  body: string;
  tags: string[];
  image_signatures: string[];
}

export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  return withTx(async (client) => {
    const picked = await client.query<JobRow>(
      `SELECT j.* FROM generation_jobs j
       JOIN tasks t ON t.id = j.task_id
       WHERE j.status = 'QUEUED' AND j.available_at <= now() AND t.status = 'QUEUED'
       ORDER BY j.created_at
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`,
    );
    const job = picked.rows[0];
    if (!job) return null;
    const updated = await client.query<JobRow>(
      `UPDATE generation_jobs
       SET status = 'RUNNING', attempts = attempts + 1, locked_at = now(), locked_by = $1,
           started_at = COALESCE(started_at, now()), last_error = NULL
       WHERE id = $2
       RETURNING *`,
      [workerId, job.id],
    );
    await client.query(`UPDATE tasks SET status = 'GENERATING' WHERE id = $1`, [job.task_id]);
    const task = await client.query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [job.task_id]);
    await writeDbLog(client, job.task_id, job.id, 'INFO', 'JOB_STARTED', `Worker ${workerId} 开始执行生成任务（第 ${updated.rows[0].attempts} 次尝试）`);
    return { job: updated.rows[0], task: task.rows[0] };
  });
}

export async function recoverStaleJobs(): Promise<void> {
  const stale = await q<JobRow>(
    `SELECT * FROM generation_jobs
     WHERE status = 'RUNNING' AND locked_at < now() - ($1::text || ' milliseconds')::interval`,
    [config.jobStaleMs],
  );
  for (const job of stale.rows) {
    await withTx(async (client) => {
      const lock = await client.query<JobRow>('SELECT * FROM generation_jobs WHERE id = $1 FOR UPDATE', [job.id]);
      if (lock.rows[0]?.status !== 'RUNNING') return;
      const task = await client.query<TaskRow>('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [job.task_id]);
      if (!task.rows[0] || task.rows[0].status === 'VOID') {
        await client.query(
          `UPDATE generation_jobs SET status = 'CANCELLED', finished_at = now(), locked_at = NULL, locked_by = NULL WHERE id = $1`,
          [job.id],
        );
        return;
      }
      if (lock.rows[0].attempts >= lock.rows[0].max_attempts) {
        await client.query(
          `UPDATE generation_jobs SET status = 'FAILED', last_error = 'Worker 失联且重试次数耗尽', finished_at = now(),
             locked_at = NULL, locked_by = NULL WHERE id = $1`,
          [job.id],
        );
        await client.query(
          `UPDATE tasks SET status = 'FAILED', failure_reason = '生成进程失联且重试次数耗尽' WHERE id = $1`,
          [job.task_id],
        );
        await client.query(
          `INSERT INTO generation_logs (task_id, job_id, level, event, message)
           VALUES ($1,$2,'ERROR','JOB_STALE_FAILED','Worker 心跳超时，重试次数耗尽，任务失败')`,
          [job.task_id, job.id],
        );
        await createNotification(
          client,
          task.rows[0].submitter_id,
          'TASK_FAILED',
          `任务 ${task.rows[0].task_no} 生成失败`,
          '生成进程失联且自动重试次数耗尽，管理员可在后台重试或作废任务。',
          task.rows[0].id,
        );
      } else {
        await client.query(
          `UPDATE generation_jobs SET status = 'QUEUED', available_at = now(), locked_at = NULL, locked_by = NULL,
             last_error = 'Worker 心跳超时，已自动重新入队' WHERE id = $1`,
          [job.id],
        );
        await client.query(`UPDATE tasks SET status = 'QUEUED' WHERE id = $1 AND status = 'GENERATING'`, [job.task_id]);
        await client.query(
          `INSERT INTO generation_logs (task_id, job_id, level, event, message)
           VALUES ($1,$2,'WARN','JOB_STALE_REQUEUED','Worker 心跳超时，任务已自动重新入队')`,
          [job.task_id, job.id],
        );
      }
    });
  }
}

export async function heartbeat(workerId: string, startedAt: Date): Promise<void> {
  await q(
    `INSERT INTO worker_heartbeat (id, worker_id, started_at, last_seen_at)
     VALUES (1,$1,$2,now())
     ON CONFLICT (id) DO UPDATE SET worker_id = EXCLUDED.worker_id, last_seen_at = now()`,
    [workerId, startedAt],
  );
}

async function writeDbLog(
  client: PoolClient | null,
  taskId: string,
  jobId: string | null,
  level: 'INFO' | 'WARN' | 'ERROR',
  event: string,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const sql = `INSERT INTO generation_logs (task_id, job_id, level, event, message, meta)
               VALUES ($1,$2,$3,$4,$5,$6)`;
  const params = [taskId, jobId, level, event, message, JSON.stringify(meta)];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, a, b) => values[a ?? b] ?? '');
}

function seededIndex(seed: string, length: number): number {
  const value = parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16);
  return value % length;
}

function pickOption(options: string[], seed: string, fallback: string): string {
  if (!options.length) return fallback;
  return options[seededIndex(seed, options.length)] ?? options[0];
}

function makeVariant(
  prompt: PromptSnapshot['image']['content'],
  groupNo: number,
  imageIndex: number,
  attempt: number,
  jobAttempt: number,
): GenerateVariants {
  const seed = `variant:${groupNo}:${imageIndex}:${attempt}:${jobAttempt}`;
  const angle = pickOption(prompt.variantOptions.angles, `${seed}:a`, '小幅度左倾');
  const crop = pickOption(prompt.variantOptions.crops, `${seed}:c`, '半盘特写');
  const garnish = pickOption(prompt.variantOptions.garnishes, `${seed}:g`, '柠檬与香草对角摆放');
  const light = pickOption(prompt.variantOptions.lights, `${seed}:l`, '暖自然光');
  const positions = ['centre', 'north', 'south', 'east', 'west'] as const;
  const cropPosition = positions[seededIndex(`${seed}:p`, positions.length)];
  const big = angle.includes('大幅');
  const degrees = angle.includes('左倾') ? (big ? -5.2 : -2.1) : big ? 5.2 : 2.1;
  return {
    angle,
    crop,
    garnish,
    light,
    rotateDegrees: degrees + (attempt > 1 ? (attempt % 2 === 0 ? 0.8 : -0.8) : 0),
    cropMode: crop.includes('局部') ? 'close' : crop.includes('半盘') ? 'half' : 'full',
    colorMode: light.includes('暖') ? 'warm' : light.includes('冷') ? 'cool' : 'highlight',
    flip: seededIndex(`${seed}:f`, 2) === 1,
    cropPosition,
  };
}

function variantPrompt(prompt: PromptSnapshot['image']['content'], variant: GenerateVariants) {
  const positive = fill(prompt.positiveTemplate, {
    angle: variant.angle,
    crop: variant.crop,
    garnish: variant.garnish,
    light: variant.light,
  });
  return { positive, negative: prompt.negativeTemplate };
}

async function ensureJobActive(jobId: string, taskId: string): Promise<void> {
  const row = await one<{ task_status: string; job_status: string }>(
    `SELECT t.status AS task_status, j.status AS job_status
     FROM tasks t JOIN generation_jobs j ON j.task_id = t.id WHERE t.id = $1 AND j.id = $2`,
    [taskId, jobId],
  );
  if (!row) throw new CancelledError('任务或队列不存在');
  if (row.task_status === 'VOID' || row.job_status === 'CANCELLED') throw new CancelledError();
}

async function generateOneGroup(args: {
  job: JobRow;
  task: TaskRow;
  images: TaskImageRow[];
  snapshot: PromptSnapshot;
  groupNo: number;
  existingGroups: ExistingGroup[];
}): Promise<ExistingGroup> {
  const { job, task, images, snapshot, groupNo, existingGroups } = args;
  const providerLog = (level: 'INFO' | 'WARN' | 'ERROR', event: string, message: string, meta?: Record<string, unknown>) =>
    writeDbLog(null, task.id, job.id, level, event, message, meta);

  let copy: CopyVariant | null = null;
  let textSimilarityMax = 0;
  for (let attempt = 1; attempt <= config.maxGroupAttempts; attempt += 1) {
    try {
      const candidate = await generateCopyWithProvider({
        task,
        prompt: snapshot.copy.content,
        groupNo,
        attempt,
        jobAttempt: job.attempts,
        avoidTitles: existingGroups.map((group) => group.title),
        log: providerLog,
      });
      const validation = validateCopyAgainstTask(candidate, task);
      if (!validation.ok) {
        await providerLog('WARN', 'COPY_VALIDATION_FAILED', `第 ${groupNo} 组文案校验失败：${validation.reason}`, { attempt });
        continue;
      }
      const promptText = normalizeForSimilarity(snapshot.copy.content.systemPrompt ?? '');
      const candidateText = normalizeForSimilarity(`${candidate.title}${candidate.body}`);
      const leaked = promptText.length >= 20 && promptText
        .match(new RegExp(`.{20}`, 'g'))
        ?.some((chunk) => candidateText.includes(chunk));
      if (leaked || candidateText.includes('systemprompt') || candidateText.includes('{{')) {
        await providerLog('WARN', 'COPY_PROMPT_LEAK_REJECTED', `第 ${groupNo} 组文案疑似回显内部提示词，重新生成`, { attempt });
        continue;
      }
      const normalizedTitle = candidate.title.replace(/[\s#＃｜|]/g, '');
      if (existingGroups.some((group) => group.title.replace(/[\s#＃｜|]/g, '') === normalizedTitle)) {
        await providerLog('WARN', 'COPY_TITLE_DUPLICATE', `第 ${groupNo} 组标题与已有组重复，重新生成`, { attempt });
        continue;
      }
      const tagKey = [...candidate.tags].sort().join('|');
      if (existingGroups.some((group) => [...group.tags].sort().join('|') === tagKey)) {
        await providerLog('WARN', 'COPY_TAGS_DUPLICATE', `第 ${groupNo} 组标签组合与已有组重复，重新生成`, { attempt });
        continue;
      }
      const similarities = existingGroups.map((group) => copySimilarity(candidate.body, group.body));
      const max = similarities.length ? Math.max(...similarities) : 0;
      if (max >= config.textSimilarityThreshold) {
        await providerLog('WARN', 'COPY_DUPLICATE_REJECTED', `第 ${groupNo} 组文案相似度 ${max.toFixed(3)} 超阈值，重新生成`, {
          attempt,
          threshold: config.textSimilarityThreshold,
        });
        continue;
      }
      copy = candidate;
      textSimilarityMax = max;
      break;
    } catch (error) {
      await providerLog('WARN', 'COPY_GENERATION_ATTEMPT_FAILED', `第 ${groupNo} 组文案生成失败：${(error as Error).message}`, {
        attempt,
      });
    }
  }
  if (!copy) throw new Error(`第 ${groupNo} 组文案在 ${config.maxGroupAttempts} 次尝试后仍未通过校验`);

  const generatedImages: Array<{ image: ValidatedImage; variant: GenerateVariants; source: TaskImageRow }> = [];
  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    const source = images[imageIndex];
    const previousSignatures = existingGroups
      .map((group) => group.image_signatures?.[imageIndex])
      .filter((signature): signature is string => typeof signature === 'string' && signature.length > 0);
    let accepted: { image: ValidatedImage; variant: GenerateVariants } | null = null;

    for (let attempt = 1; attempt <= config.maxGroupAttempts; attempt += 1) {
      const variant = makeVariant(snapshot.image.content, groupNo, imageIndex, attempt, job.attempts);
      try {
        const image = await generateImageWithProvider({
          sourcePath: resolveDataPath(source.file_path),
          prompt: variantPrompt(snapshot.image.content, variant),
          variant,
          log: providerLog,
        });
        const maxCorrelation = previousSignatures.length
          ? Math.max(...previousSignatures.map((signature) => imageCorrelation(signature, image.signature)))
          : 0;
        const nearDuplicate = maxCorrelation >= config.imageCorrelationThreshold;
        if (nearDuplicate) {
          await providerLog('WARN', 'IMAGE_DUPLICATE_REJECTED', `第 ${groupNo} 组第 ${imageIndex + 1} 张图近似度过高，重新生成`, {
            attempt,
            variant,
            maxCorrelation: Number(maxCorrelation.toFixed(4)),
          });
          continue;
        }
        accepted = { image, variant };
        break;
      } catch (error) {
        await providerLog('WARN', 'IMAGE_GENERATION_ATTEMPT_FAILED', `第 ${groupNo} 组第 ${imageIndex + 1} 张图生成失败：${(error as Error).message}`, {
          attempt,
          variant,
        });
      }
    }
    if (!accepted) {
      throw new Error(`第 ${groupNo} 组第 ${imageIndex + 1} 张图在 ${config.maxGroupAttempts} 次尝试后仍未通过质量/相似度校验`);
    }
    generatedImages.push({ ...accepted, source });
  }

  const groupId = crypto.randomUUID();
  const saved: Array<{
    sourceId: string;
    variant: GenerateVariants;
    filePath: string;
    thumbPath: string;
  }> = [];
  try {
    for (let index = 0; index < generatedImages.length; index += 1) {
      const generated = generatedImages[index];
      const files = await saveGeneratedImage(task.id, groupNo, index, generated.image.buffer);
      saved.push({
        sourceId: generated.source.id,
        variant: generated.variant,
        filePath: files.filePath,
        thumbPath: files.thumbPath,
      });
    }

    const groupCode = `SW-${task.task_no.replace(/^T/, '')}-${String(groupNo).padStart(2, '0')}`;
    const inserted = await withTx(async (client) => {
      const active = await client.query<{ task_status: string; job_status: string }>(
        `SELECT t.status AS task_status, j.status AS job_status
         FROM tasks t JOIN generation_jobs j ON j.task_id = t.id
         WHERE t.id = $1 AND j.id = $2 FOR UPDATE OF t, j`,
        [task.id, job.id],
      );
      if (!active.rows[0] || active.rows[0].task_status === 'VOID' || active.rows[0].job_status === 'CANCELLED') {
        throw new CancelledError();
      }
      const duplicate = await client.query('SELECT id FROM content_groups WHERE task_id = $1 AND group_no = $2', [task.id, groupNo]);
      if (duplicate.rows[0]) {
        await removeGroupFolder(task.id, groupNo);
        return { id: duplicate.rows[0].id, duplicate: true };
      }
      const group = await client.query(
        `INSERT INTO content_groups
           (id, task_id, group_no, group_code, title, body, tags, status, image_signatures, text_similarity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'STAGED',$8,$9)
         RETURNING id`,
        [
          groupId,
          task.id,
          groupNo,
          groupCode,
          copy!.title,
          copy!.body,
          JSON.stringify(copy!.tags),
          JSON.stringify(generatedImages.map((item) => item.image.signature)),
          textSimilarityMax,
        ],
      );
      for (let index = 0; index < saved.length; index += 1) {
        const item = saved[index];
        await client.query(
          `INSERT INTO content_group_images
             (group_id, source_image_id, file_path, thumb_path, width, height,
              angle_variant, crop_variant, garnish_variant, light_variant, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            group.rows[0].id,
            item.sourceId,
            item.filePath,
            item.thumbPath,
            generatedImages[index].image.width,
            generatedImages[index].image.height,
            item.variant.angle,
            item.variant.crop,
            item.variant.garnish,
            item.variant.light,
            index,
          ],
        );
      }
      await client.query(
        `UPDATE generation_jobs SET completed_groups = $1, locked_at = now() WHERE id = $2`,
        [existingGroups.length + 1, job.id],
      );
      await writeDbLog(
        client,
        task.id,
        job.id,
        'INFO',
        'GROUP_GENERATED',
        `第 ${groupNo} 组已生成并通过相似度校验`,
        {
          groupNo,
          groupCode,
          textSimilarity: Number(textSimilarityMax.toFixed(4)),
          imageSimilarityChecked: true,
          variants: saved.map((item) => ({
            angle: item.variant.angle,
            crop: item.variant.crop,
            light: item.variant.light,
          })),
        },
      );
      return { id: group.rows[0].id, duplicate: false };
    });

    if (inserted.duplicate) {
      const existing = await one<ExistingGroup>(
        'SELECT id, group_no, title, body, tags, image_signatures FROM content_groups WHERE id = $1',
        [inserted.id],
      );
      if (!existing) throw new Error('组内容写入冲突');
      return existing;
    }
    return {
      id: groupId,
      group_no: groupNo,
      title: copy.title,
      body: copy.body,
      tags: copy.tags,
      image_signatures: generatedImages.map((item) => item.image.signature),
    };
  } catch (error) {
    await removeGroupFolder(task.id, groupNo);
    throw error;
  }
}

async function finalizeJob(job: JobRow, task: TaskRow): Promise<void> {
  await withTx(async (client) => {
    const lock = await client.query<JobRow>('SELECT * FROM generation_jobs WHERE id = $1 FOR UPDATE', [job.id]);
    if (lock.rows[0]?.status === 'CANCELLED') throw new CancelledError();
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM content_groups WHERE task_id = $1 AND status IN ('STAGED','AVAILABLE','CLAIMED')`,
      [task.id],
    );
    if (Number(count.rows[0]?.count ?? 0) < job.total_groups) {
      throw new Error('生成组数不足，不能完成队列');
    }
    await client.query(
      `UPDATE content_groups SET status = 'AVAILABLE' WHERE task_id = $1 AND status = 'STAGED'`,
      [task.id],
    );
    await client.query(
      `UPDATE generation_jobs SET status = 'SUCCEEDED', completed_groups = total_groups, finished_at = now(),
         locked_at = NULL, locked_by = NULL, last_error = NULL WHERE id = $1`,
      [job.id],
    );
    await client.query(
      `UPDATE tasks SET status = 'COMPLETED', failure_reason = NULL WHERE id = $1`,
      [task.id],
    );
    await writeDbLog(
      client,
      task.id,
      job.id,
      'INFO',
      'JOB_SUCCEEDED',
      `生成完成，${job.total_groups} 组内容已全部进入公共内容池`,
      { totalGroups: job.total_groups },
    );
    await createNotification(
      client,
      task.submitter_id,
      'TASK_COMPLETED',
      `任务 ${task.task_no} 生成完成`,
      `${job.total_groups} 组内容已进入公共池。内容不会自动分配给你，请前往内容池领取（每组只能被一人领取）。`,
      task.id,
    );
    await writeAudit(
      {
        actorId: null,
        actorRole: null,
        action: 'GENERATION_COMPLETED',
        targetType: 'task',
        targetId: task.id,
        meta: { totalGroups: job.total_groups, attempts: job.attempts },
      },
      client,
    );
  });
}

async function markJobFailure(job: JobRow, task: TaskRow, error: Error): Promise<'REQUEUED' | 'FAILED' | 'CANCELLED'> {
  return withTx(async (client) => {
    const lock = await client.query<JobRow>('SELECT * FROM generation_jobs WHERE id = $1 FOR UPDATE', [job.id]);
    const current = lock.rows[0];
    if (!current) throw new Error('队列不存在');
    if (current.status === 'CANCELLED') return 'CANCELLED';
    if (current.attempts < current.max_attempts) {
      const backoffSeconds = Math.min(120, 15 * current.attempts);
      await client.query(
        `UPDATE generation_jobs SET status = 'QUEUED', available_at = now() + ($1::text || ' seconds')::interval,
           locked_at = NULL, locked_by = NULL, last_error = $2 WHERE id = $3`,
        [backoffSeconds, error.message.slice(0, 2000), job.id],
      );
      await client.query(`UPDATE tasks SET status = 'QUEUED', failure_reason = $1 WHERE id = $2`, [
        `第 ${current.attempts} 次生成失败，等待自动重试`,
        task.id,
      ]);
      await writeDbLog(
        client,
        task.id,
        job.id,
        'WARN',
        'JOB_REQUEUED',
        `第 ${current.attempts} 次生成失败，${backoffSeconds}s 后自动重试：${error.message}`,
        { attempts: current.attempts, maxAttempts: current.max_attempts },
      );
      return 'REQUEUED';
    }
    await client.query(
      `UPDATE generation_jobs SET status = 'FAILED', last_error = $1, finished_at = now(),
         locked_at = NULL, locked_by = NULL WHERE id = $2`,
      [error.message.slice(0, 2000), job.id],
    );
    await client.query(
      `UPDATE tasks SET status = 'FAILED', failure_reason = $1 WHERE id = $2`,
      [error.message.slice(0, 500), task.id],
    );
    await writeDbLog(
      client,
      task.id,
      job.id,
      'ERROR',
      'JOB_FAILED',
      `生成失败且重试次数耗尽：${error.message}`,
      { attempts: current.attempts },
    );
    await createNotification(
      client,
      task.submitter_id,
      'TASK_FAILED',
      `任务 ${task.task_no} 生成失败`,
      '自动重试次数已耗尽，管理员可在后台查看日志并重试或作废任务。已有内容不会自动分配。',
      task.id,
    );
    return 'FAILED';
  });
}

export async function processGenerationJob(claimed: ClaimedJob): Promise<'SUCCEEDED' | 'REQUEUED' | 'FAILED' | 'CANCELLED'> {
  const { job, task } = claimed;
  const images = await q<TaskImageRow>('SELECT * FROM task_images WHERE task_id = $1 ORDER BY sort_order', [task.id]);
  const existingRows = await q<ExistingGroup>(
    `SELECT id, group_no, title, body, tags, image_signatures FROM content_groups
     WHERE task_id = $1 AND status <> 'WITHDRAWN' ORDER BY group_no`,
    [task.id],
  );
  const existing = [...existingRows.rows];

  try {
    await ensureJobActive(job.id, task.id);
    if (existing.length >= job.total_groups) {
      await finalizeJob(job, task);
      return 'SUCCEEDED';
    }
    for (let groupNo = 1; groupNo <= job.total_groups; groupNo += 1) {
      if (existing.some((group) => group.group_no === groupNo)) continue;
      await ensureJobActive(job.id, task.id);
      const generated = await generateOneGroup({
        job,
        task,
        images: images.rows,
        snapshot: job.prompt_snapshot,
        groupNo,
        existingGroups: existing,
      });
      if (!existing.some((group) => group.id === generated.id)) existing.push(generated);
      logger.info({ taskId: task.id, jobId: job.id, groupNo }, '生成组完成');
    }
    await finalizeJob(job, task);
    return 'SUCCEEDED';
  } catch (error) {
    if (error instanceof CancelledError) {
      await withTx(async (client) => {
        await client.query(
          `UPDATE generation_jobs SET status = 'CANCELLED', finished_at = now(), locked_at = NULL, locked_by = NULL
           WHERE id = $1 AND status IN ('RUNNING','QUEUED')`,
          [job.id],
        );
        await writeDbLog(client, task.id, job.id, 'WARN', 'JOB_CANCELLED', '任务在生成过程中被作废，队列已停止');
      });
      return 'CANCELLED';
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: failure, taskId: task.id, jobId: job.id }, '生成任务失败');
    return markJobFailure(job, task, failure);
  }
}
