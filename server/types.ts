export type Role = 'ADMIN' | 'AGENT' | 'USER';
export type UserStatus = 'ACTIVE' | 'DISABLED';
export type TaskStatus =
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'QUEUED'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'VOID';
export type GroupStatus = 'AVAILABLE' | 'CLAIMED' | 'WITHDRAWN';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  inviteEnabled: boolean;
  invitedBy: string | null;
  sessionId: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  invite_enabled: boolean;
  invited_by: string | null;
  created_by: string | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskRow {
  id: string;
  task_no: string;
  submitter_id: string;
  status: TaskStatus;
  generation_count: number;
  source_title: string;
  source_body: string;
  selling_points: string[];
  tags: string[];
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  void_reason: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskImageRow {
  id: string;
  task_id: string;
  file_path: string;
  thumb_path: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  sha256: string;
  sort_order: number;
  created_at: Date;
}

export interface JobRow {
  id: string;
  task_id: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  total_groups: number;
  completed_groups: number;
  prompt_snapshot: PromptSnapshot;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GroupRow {
  id: string;
  task_id: string;
  group_no: number;
  group_code: string;
  title: string;
  body: string;
  tags: string[];
  status: GroupStatus;
  claimed_by: string | null;
  claimed_at: Date | null;
  image_signatures: string[];
  text_similarity: number;
  created_at: Date;
  updated_at: Date;
}

export interface GroupImageRow {
  id: string;
  group_id: string;
  source_image_id: string | null;
  file_path: string;
  thumb_path: string;
  width: number;
  height: number;
  angle_variant: string;
  crop_variant: string;
  garnish_variant: string;
  light_variant: string;
  sort_order: number;
  created_at: Date;
}

export interface ImagePromptContent {
  positiveTemplate: string;
  negativeTemplate: string;
  variantOptions: {
    angles: string[];
    crops: string[];
    garnishes: string[];
    lights: string[];
  };
  outputSize: string;
}

export interface CopyPromptContent {
  systemPrompt: string;
  userTemplate: string;
  titleHooks: string[];
  openingLines: string[];
  narrativeStructures: string[];
  tagLibrary: string[];
}

export interface PromptSnapshot {
  image: {
    id: string;
    version: number;
    content: ImagePromptContent;
  };
  copy: {
    id: string;
    version: number;
    content: CopyPromptContent;
  };
}

export interface GenerateVariants {
  angle: string;
  crop: string;
  garnish: string;
  light: string;
  rotateDegrees: number;
  cropMode: 'close' | 'half' | 'full';
  colorMode: 'warm' | 'cool' | 'highlight';
  flip: boolean;
  cropPosition: 'centre' | 'north' | 'south' | 'east' | 'west';
}

export interface CopyVariant {
  title: string;
  body: string;
  tags: string[];
}

export interface GeneratedImage {
  buffer: Buffer;
  width: number;
  height: number;
  signature: string;
}

export interface ProviderConfigRow {
  kind: 'TEXT' | 'IMAGE';
  provider: 'mock' | 'openai';
  base_url: string | null;
  model: string | null;
  api_key_ciphertext: string | null;
  options: Record<string, unknown>;
  updated_by: string | null;
  updated_at: Date;
}
