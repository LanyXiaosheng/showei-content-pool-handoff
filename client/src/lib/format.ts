import { format, formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return format(new Date(value), 'yyyy.MM.dd');
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return format(new Date(value), 'MM.dd HH:mm');
}

export function fromNow(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: zhCN });
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}

export function truncate(value: string, length = 80): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: '待审核',
  REJECTED: '已驳回',
  QUEUED: '排队中',
  GENERATING: '生成中',
  COMPLETED: '已完成',
  FAILED: '生成失败',
  VOID: '已作废',
};

export const GROUP_STATUS_LABEL: Record<string, string> = {
  STAGED: '待入池',
  AVAILABLE: '可领取',
  CLAIMED: '已领取',
  WITHDRAWN: '已下架',
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: '管理员',
  AGENT: '代理',
  USER: '普通用户',
};

export const INVITE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '可用',
  EXPIRED: '已过期',
  USED: '已用完',
  REVOKED: '已撤销',
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};
