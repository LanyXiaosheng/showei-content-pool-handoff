export type Role = 'ADMIN' | 'AGENT' | 'USER';
export type TaskStatus = 'PENDING_REVIEW' | 'REJECTED' | 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'VOID';
export type GroupStatus = 'STAGED' | 'AVAILABLE' | 'CLAIMED' | 'WITHDRAWN';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  inviteEnabled: boolean;
  status: 'ACTIVE' | 'DISABLED';
}

export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TaskSummary {
  id: string;
  taskNo: string;
  status: TaskStatus;
  generationCount: number;
  sourceTitle: string;
  sourceBody: string;
  sellingPoints: string[];
  tags: string[];
  reviewComment: string | null;
  reviewedAt: string | null;
  voidReason: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  submitter: { id: string; displayName: string; email: string; role: Role };
  imageCount: number;
  coverImageId: string | null;
  availableGroups: number;
  claimedGroups: number;
  job: null | { status: string; completedGroups: number; totalGroups: number; attempts: number };
}

export interface TaskJobDetail {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  completedGroups: number;
  totalGroups: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskDetail extends Omit<TaskSummary, 'job'> {
  job: TaskJobDetail | null;
  review: { reviewedBy: string | null; reviewedAt: string | null; comment: string | null };
  counts: { available: number; claimed: number; withdrawn: number; generatedImages: number };
  images: Array<{ id: string; originalName: string; width: number; height: number; byteSize: number; sortOrder: number }>;
  permissions: { canReview: boolean; canVoid: boolean; canRetry: boolean };
}

export interface TaskLog {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface PoolItem {
  id: string;
  groupCode: string;
  title: string;
  preview: string;
  tags: string[];
  createdAt: string;
  coverImageId: string | null;
  imageCount: number;
  remaining: number;
}

export interface LibraryItem extends Omit<PoolItem, 'preview' | 'createdAt' | 'remaining'> {
  body: string;
  claimedAt: string;
  taskNo: string;
}

export interface AdminContentItem {
  id: string;
  groupCode: string;
  groupNo: number;
  title: string;
  status: GroupStatus;
  taskNo: string;
  sourceTitle: string;
  claimantName: string | null;
  claimedAt: string | null;
  createdAt: string;
  coverImageId: string | null;
  imageCount: number;
}

export interface Invite {
  id: string;
  code: string;
  role: Role;
  inviterId: string;
  inviterName: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  note: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'USED' | 'REVOKED';
  url: string;
}

export interface PromptTemplate {
  id: string;
  kind: 'IMAGE' | 'COPY';
  name: string;
  version: number;
  content: Record<string, any>;
  isActive: boolean;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
}

export interface ProviderSummary {
  kind: 'TEXT' | 'IMAGE';
  provider: 'mock' | 'openai';
  baseUrl: string | null;
  model: string | null;
  options: Record<string, any>;
  hasApiKey: boolean;
  keyMask: string | null;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardData {
  role: Role;
  stats: Record<string, number | boolean>;
  recentTasks: TaskSummary[];
  series: Array<{ day: string; count: number }>;
  worker?: { online: boolean; workerId: string | null; lastSeenAt: string | null; startedAt: string | null };
}

export interface TeamUser {
  id: string;
  email: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
  last_login_at: string | null;
  task_count: number;
  pending_count: number;
  completed_count: number;
  last_task_at: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  invite_enabled: boolean;
  invited_by: string | null;
  created_at: string;
  last_login_at: string | null;
  inviter_name: string | null;
  task_count: number;
  downline_count: number;
}
