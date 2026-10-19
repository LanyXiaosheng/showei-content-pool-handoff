import crypto from 'node:crypto';
import sharp from 'sharp';
import { badRequest } from '../lib/errors';
import type { GenerateVariants } from '../types';

const OUTPUT_WIDTH = 900;
const OUTPUT_HEIGHT = 1200;

function colorPipeline(image: sharp.Sharp, mode: GenerateVariants['colorMode']): sharp.Sharp {
  if (mode === 'warm') {
    return image
      .modulate({ brightness: 1.03, saturation: 1.08, hue: 5 })
      .linear([1.025, 1.0, 0.965], [0, 0, 0]);
  }
  if (mode === 'cool') {
    return image
      .modulate({ brightness: 1.01, saturation: 0.98, hue: -4 })
      .linear([0.97, 1.0, 1.035], [0, 0, 0]);
  }
  return image.modulate({ brightness: 1.07, saturation: 1.05 }).linear(1.02, -3);
}

async function grainOverlay(width: number, height: number): Promise<Buffer> {
  const w = Math.round(width / 2);
  const h = Math.round(height / 2);
  const pixels = Buffer.alloc(w * h * 4);
  const random = crypto.randomBytes(w * h * 2);
  for (let i = 0; i < w * h; i += 1) {
    const value = 118 + (random[i * 2] % 25);
    pixels[i * 4] = value;
    pixels[i * 4 + 1] = value;
    pixels[i * 4 + 2] = value;
    pixels[i * 4 + 3] = 24 + (random[i * 2 + 1] % 15);
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
    .resize(width, height)
    .png()
    .toBuffer();
}

function vignetteSvg(width: number, height: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="v" cx="50%" cy="48%" r="72%">
        <stop offset="52%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#3a2418" stop-opacity="0.28"/>
      </radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#v)"/>
    </svg>`,
  );
}

/**
 * 演示模式变体：保留原始餐盘主体，用裁切/旋转/光影/颗粒模拟外接图生图服务。
 * 真实 API 模式仍走同样的结果归一化与质量卡口。
 */
export async function mockImageVariant(source: Buffer, variant: GenerateVariants): Promise<Buffer> {
  let prepared = sharp(source, { failOn: 'error' }).rotate();
  if (variant.flip) prepared = prepared.flop();
  const rotated = await prepared
    .resize({
      width: variant.cropMode === 'close' ? 1800 : variant.cropMode === 'half' ? 1560 : 1400,
      height: variant.cropMode === 'close' ? 2400 : variant.cropMode === 'half' ? 2080 : 1867,
      fit: 'cover',
      position: variant.cropPosition,
    })
    .toBuffer();

  const tilted = await sharp(rotated)
    .rotate(variant.rotateDegrees, { background: { r: 244, g: 238, b: 228, alpha: 1 } })
    .toBuffer();
  const tiltedMeta = await sharp(tilted).metadata();
  const cropWidth = Math.max(1, Math.round((tiltedMeta.width ?? OUTPUT_WIDTH) * 0.86));
  const cropHeight = Math.max(1, Math.round((tiltedMeta.height ?? OUTPUT_HEIGHT) * 0.86));
  let framed = sharp(tilted)
    .extract({
      left: Math.max(0, Math.round(((tiltedMeta.width ?? cropWidth) - cropWidth) / 2)),
      top: Math.max(0, Math.round(((tiltedMeta.height ?? cropHeight) - cropHeight) / 2)),
      width: cropWidth,
      height: cropHeight,
    })
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'centre' });

  framed = colorPipeline(framed, variant.colorMode)
    .modulate({ brightness: 1.0 + Math.random() * 0.015 })
    .sharpen({ sigma: 0.55, m1: 0.6, m2: 0.4 });

  const grain = await grainOverlay(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  const vignette = vignetteSvg(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  return framed
    .composite([
      { input: vignette, blend: 'multiply' },
      { input: grain, blend: 'soft-light' },
    ])
    .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toBuffer();
}

export interface ValidatedImage {
  buffer: Buffer;
  width: number;
  height: number;
  signature: string;
  entropy: number;
  sharpness: number;
}

export async function validateAndNormalizeGeneratedImage(input: Buffer): Promise<ValidatedImage> {
  let metadata;
  try {
    metadata = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw badRequest('生成图无法解码，已丢弃');
  }
  if (!metadata.width || !metadata.height) throw badRequest('生成图缺少尺寸信息，已丢弃');
  if (metadata.width < 512 || metadata.height < 512) throw badRequest('生成图分辨率过低，已丢弃');

  // 强制 3:4 输出，使用 attention 尽量保留餐盘主体。
  const normalized = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 89, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toBuffer();

  const stats = await sharp(normalized).stats();
  const entropy = stats.entropy ?? 0;
  const sharpness = stats.sharpness ?? 0;
  if (entropy < 3.2) throw badRequest('生成图信息量异常（疑似纯色/糊图），已丢弃');
  if (sharpness < 0.25) throw badRequest('生成图清晰度不足，已丢弃');
  return {
    buffer: normalized,
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    signature: await imageSignature(normalized),
    entropy,
    sharpness,
  };
}

/**
 * 空间布局指纹：48×64 灰度图 base64。比较时先做亮度归一化再算相关系数，
 * 能识别“同一张图轻微换色”的雷同，又允许真实的构图/裁切变化。
 */
export async function imageSignature(buffer: Buffer): Promise<string> {
  const raw = await sharp(buffer)
    .resize(48, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  return raw.toString('base64');
}

export function imageCorrelation(signatureA: string, signatureB: string): number {
  const a = Buffer.from(signatureA, 'base64');
  const b = Buffer.from(signatureB, 'base64');
  if (!a.length || a.length !== b.length) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= b.length;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    numerator += x * y;
    varianceA += x * x;
    varianceB += y * y;
  }
  if (varianceA === 0 || varianceB === 0) return 0;
  return Math.max(0, Math.min(1, numerator / Math.sqrt(varianceA * varianceB)));
}

export function normalizeForSimilarity(text: string): string {
  return text
    .toLowerCase()
    .replace(/[#＃\s，。！？、；：“”‘’（）()【】\[\]…—\-·,.!?;:'"<>《》]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function textSimilarity(a: string, b: string, n = 4): number {
  const left = shingles(normalizeForSimilarity(a), n);
  const right = shingles(normalizeForSimilarity(b), n);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function shingles(text: string, n: number): Set<string> {
  const result = new Set<string>();
  if (text.length <= n) {
    if (text) result.add(text);
    return result;
  }
  for (let i = 0; i <= text.length - n; i += 1) result.add(text.slice(i, i + n));
  return result;
}
