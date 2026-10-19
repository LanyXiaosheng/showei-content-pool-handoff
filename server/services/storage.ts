import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config';
import { badRequest } from '../lib/errors';

export interface StoredTaskImage {
  filePath: string;
  thumbPath: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  sortOrder: number;
}

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(config.uploadDir, { recursive: true }),
    fs.mkdir(config.generatedDir, { recursive: true }),
    fs.mkdir(config.sampleDir, { recursive: true }),
  ]);
}

export function resolveDataPath(relative: string): string {
  const full = path.resolve(config.dataDir, relative);
  const root = config.dataDir.endsWith(path.sep) ? config.dataDir : `${config.dataDir}${path.sep}`;
  if (!full.startsWith(root)) throw badRequest('非法文件路径');
  return full;
}

function rel(absolute: string): string {
  return path.relative(config.dataDir, absolute).split(path.sep).join('/');
}

export async function processTaskImages(
  taskTempId: string,
  files: Array<{ buffer: Buffer; filename: string; mimetype: string }>,
): Promise<StoredTaskImage[]> {
  if (files.length === 0) throw badRequest('请至少上传 1 张原始菜品图');
  if (files.length > config.maxImagesPerTask) throw badRequest(`最多上传 ${config.maxImagesPerTask} 张图片`);
  const dir = path.join(config.uploadDir, 'tasks', taskTempId);
  await fs.mkdir(dir, { recursive: true });
  const seen = new Set<string>();
  const stored: StoredTaskImage[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw badRequest(`第 ${index + 1} 张图片格式不支持，仅支持 JPG/PNG/WebP`);
    }
    if (file.buffer.length > config.maxUploadBytes) {
      throw badRequest(`第 ${index + 1} 张图片超过 12MB`);
    }
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, { failOn: 'error' }).metadata();
    } catch {
      throw badRequest(`第 ${index + 1} 张图片无法解析，请换一张`);
    }
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw badRequest(`第 ${index + 1} 张图片格式不支持`);
    }
    if ((metadata.pages ?? 1) > 1) throw badRequest('不支持动图，请上传静态图片');
    if ((metadata.width ?? 0) < 500 || (metadata.height ?? 0) < 500) {
      throw badRequest(`第 ${index + 1} 张图片分辨率过低，单边至少 500px`);
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (seen.has(sha256)) throw badRequest('同一任务中不能重复上传同一张图片');
    seen.add(sha256);

    const baseName = `source_${String(index + 1).padStart(2, '0')}`;
    const sourcePath = path.join(dir, `${baseName}.jpg`);
    const thumbPath = path.join(dir, `${baseName}_thumb.webp`);
    try {
      const normalized = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 91, chromaSubsampling: '4:2:0', mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      await fs.writeFile(sourcePath, normalized.data);
      await sharp(normalized.data)
        .resize({ width: 720, height: 720, fit: 'inside' })
        .webp({ quality: 78 })
        .toFile(thumbPath);
      stored.push({
        filePath: rel(sourcePath),
        thumbPath: rel(thumbPath),
        originalName: file.filename.slice(0, 255),
        mimeType: 'image/jpeg',
        byteSize: normalized.info.size,
        width: normalized.info.width,
        height: normalized.info.height,
        sha256,
        sortOrder: index,
      });
    } catch {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw badRequest(`第 ${index + 1} 张图片处理失败，请重新上传`);
    }
  }
  return stored;
}

export async function cleanupTaskUpload(taskTempId: string): Promise<void> {
  await fs.rm(path.join(config.uploadDir, 'tasks', taskTempId), { recursive: true, force: true });
}

export async function saveGeneratedImage(
  taskId: string,
  groupNo: number,
  imageIndex: number,
  buffer: Buffer,
): Promise<{
  filePath: string;
  thumbPath: string;
  width: number;
  height: number;
}> {
  const folder = path.join(config.generatedDir, taskId, `Group_${String(groupNo).padStart(2, '0')}`);
  await fs.mkdir(folder, { recursive: true });
  const baseName = `image_${String(imageIndex + 1).padStart(2, '0')}`;
  const filePath = path.join(folder, `${baseName}.jpg`);
  const thumbPath = path.join(folder, `${baseName}_thumb.webp`);
  await fs.writeFile(filePath, buffer);
  await sharp(buffer)
    .resize({ width: 720, height: 960, fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(thumbPath);
  const metadata = await sharp(buffer).metadata();
  return {
    filePath: rel(filePath),
    thumbPath: rel(thumbPath),
    width: metadata.width ?? 900,
    height: metadata.height ?? 1200,
  };
}

export async function removeGroupFolder(taskId: string, groupNo: number): Promise<void> {
  await fs.rm(
    path.join(config.generatedDir, taskId, `Group_${String(groupNo).padStart(2, '0')}`),
    { recursive: true, force: true },
  );
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
