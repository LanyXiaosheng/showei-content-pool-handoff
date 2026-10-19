import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  expose: boolean;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = '请先登录') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '无权访问此资源') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '资源不存在') =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') =>
  new AppError(409, code, message);
export const rateLimited = (message = '请求过于频繁，请稍后再试') =>
  new AppError(429, 'RATE_LIMITED', message);

export function normalizeError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: '提交的数据格式不正确',
      details: error.flatten(),
    };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: '服务器开小差了，请稍后再试',
  };
}
