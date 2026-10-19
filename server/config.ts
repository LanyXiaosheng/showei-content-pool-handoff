import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  DATA_DIR: z.string().default('./data'),
  WEB_DIST: z.string().default('./dist/web'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  DEMO_MODE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ADMIN_EMAIL: z.string().email().default('admin@shiwei.local'),
  DEMO_PASSWORD: z.string().min(8).default('Shiwei@2026'),
  WORKER_POLL_MS: z.coerce.number().int().min(200).max(30000).default(800),
  LOG_LEVEL: z.string().default('info'),
  DIANPING_PARSER_API_URL: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`环境变量配置失败: ${fields}`);
}
const env = parsed.data;

const encryptionKey = Buffer.from(env.ENCRYPTION_KEY, 'base64');
if (encryptionKey.length !== 32) {
  throw new Error('ENCRYPTION_KEY 必须是 32 字节随机数的 base64（openssl rand -base64 32）');
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  publicOrigin: env.PUBLIC_ORIGIN,
  databaseUrl: env.DATABASE_URL,
  encryptionKey,
  dataDir: path.resolve(process.cwd(), env.DATA_DIR),
  webDist: path.resolve(process.cwd(), env.WEB_DIST),
  sessionTtlDays: env.SESSION_TTL_DAYS,
  demoMode: env.DEMO_MODE,
  adminEmail: env.ADMIN_EMAIL.toLowerCase(),
  demoPassword: env.DEMO_PASSWORD,
  workerPollMs: env.WORKER_POLL_MS,
  logLevel: env.LOG_LEVEL,
  dianpingParserApiUrl: env.DIANPING_PARSER_API_URL.trim().replace(/\/$/, ''),
  cookieName: 'shiwei_session',
  cookieSecure: env.PUBLIC_ORIGIN.startsWith('https://'),
  sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  maxUploadBytes: 12 * 1024 * 1024,
  maxImagesPerTask: 6,
  imageCorrelationThreshold: 0.985,
  textSimilarityThreshold: 0.8,
  maxGroupAttempts: 5,
  jobStaleMs: 15 * 60 * 1000,
  jobMaxAttempts: 3,
  uploadDir: path.resolve(process.cwd(), env.DATA_DIR, 'uploads'),
  generatedDir: path.resolve(process.cwd(), env.DATA_DIR, 'generated'),
  sampleDir: path.resolve(process.cwd(), env.DATA_DIR, 'samples'),
} as const;

export type AppConfig = typeof config;
