import path from 'node:path';
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function parsePagination(query: unknown): Pagination & { offset: number } {
  const parsed = paginationSchema.parse(query ?? {});
  return { ...parsed, offset: (parsed.page - 1) * parsed.pageSize };
}

export function pageMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function assertNonEmptyString(value: unknown, field: string, max = 5000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}不能为空`);
  }
  if (value.length > max) throw new Error(`${field}长度不能超过 ${max}`);
  return value.trim();
}

export function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function padGroup(no: number): string {
  return `Group_${String(no).padStart(2, '0')}`;
}
