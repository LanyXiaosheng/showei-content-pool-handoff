-- 拾味内容中台 · PostgreSQL schema
-- 所有业务时间均为 timestamptz；金额本项目不涉及。
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 账号与邀请
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  display_name    varchar(80) NOT NULL,
  role            text NOT NULL CHECK (role IN ('ADMIN', 'AGENT', 'USER')),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  invite_enabled  boolean NOT NULL DEFAULT false,
  invited_by      uuid REFERENCES users(id),
  created_by      uuid REFERENCES users(id),
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 只有代理拥有“可邀请”开关；管理员始终可邀请，普通用户永远不可邀请。
  CHECK (role = 'AGENT' OR invite_enabled = false)
);
CREATE INDEX users_role_status_idx ON users(role, status);
CREATE INDEX users_invited_by_idx ON users(invited_by) WHERE invited_by IS NOT NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   char(64) NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         varchar(24) NOT NULL UNIQUE,
  role         text NOT NULL CHECK (role IN ('AGENT', 'USER')),
  created_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  max_uses     integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 20),
  used_count   integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at   timestamptz,
  note         varchar(200),
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (used_count <= max_uses)
);
CREATE INDEX invites_creator_idx ON invites(created_by, created_at DESC);
CREATE INDEX invites_valid_idx ON invites(expires_at) WHERE revoked_at IS NULL;
CREATE TRIGGER invites_updated_at BEFORE UPDATE ON invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invite_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id   uuid NOT NULL REFERENCES invites(id),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id),
  email       citext NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_redemptions_invite_idx ON invite_redemptions(invite_id);

-- ---------------------------------------------------------------------------
-- 素材任务
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_no           varchar(32) NOT NULL UNIQUE,
  submitter_id      uuid NOT NULL REFERENCES users(id),
  status            text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN (
                      'PENDING_REVIEW', 'REJECTED', 'QUEUED', 'GENERATING',
                      'COMPLETED', 'FAILED', 'VOID')),
  generation_count  integer NOT NULL CHECK (generation_count BETWEEN 10 AND 100),
  source_title      varchar(200) NOT NULL,
  source_body       text NOT NULL,
  selling_points    jsonb NOT NULL,
  tags              jsonb NOT NULL,
  review_comment    text,
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  void_reason       text,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_selling_points_check CHECK (jsonb_typeof(selling_points) = 'array'),
  CHECK (jsonb_typeof(tags) = 'array'),
  CHECK (status <> 'REJECTED' OR (review_comment IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (status <> 'VOID' OR void_reason IS NOT NULL)
);
CREATE INDEX tasks_submitter_idx ON tasks(submitter_id, created_at DESC);
CREATE INDEX tasks_status_idx ON tasks(status, created_at DESC);
CREATE INDEX tasks_pending_idx ON tasks(created_at) WHERE status = 'PENDING_REVIEW';
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path     text NOT NULL,
  thumb_path    text NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type     varchar(64) NOT NULL,
  byte_size     integer NOT NULL CHECK (byte_size > 0),
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  sha256        char(64) NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, sha256),
  UNIQUE (task_id, sort_order)
);
CREATE INDEX task_images_task_idx ON task_images(task_id);

-- ---------------------------------------------------------------------------
-- 异步生成队列。任务领取使用 FOR UPDATE SKIP LOCKED。
-- ---------------------------------------------------------------------------
CREATE TABLE generation_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
                     'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 3,
  available_at     timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  locked_by        text,
  started_at       timestamptz,
  finished_at      timestamptz,
  total_groups     integer NOT NULL CHECK (total_groups BETWEEN 10 AND 100),
  completed_groups integer NOT NULL DEFAULT 0 CHECK (completed_groups >= 0),
  prompt_snapshot  jsonb NOT NULL,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_groups <= total_groups)
);
CREATE INDEX generation_jobs_dequeue_idx ON generation_jobs(status, available_at);
CREATE INDEX generation_jobs_task_idx ON generation_jobs(task_id);
CREATE TRIGGER generation_jobs_updated_at BEFORE UPDATE ON generation_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE generation_logs (
  id         bigserial PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  job_id     uuid REFERENCES generation_jobs(id) ON DELETE CASCADE,
  level      text NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  event      varchar(80) NOT NULL,
  message    text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_logs_task_idx ON generation_logs(task_id, created_at DESC);
CREATE INDEX generation_logs_job_idx ON generation_logs(job_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 公共内容池：一行就是一个独占内容包（组）。
-- ---------------------------------------------------------------------------
CREATE TABLE content_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  group_no        integer NOT NULL CHECK (group_no > 0),
  group_code      varchar(40) NOT NULL UNIQUE,
  title           varchar(200) NOT NULL,
  body            text NOT NULL,
  tags            jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'AVAILABLE', 'CLAIMED', 'WITHDRAWN')),
  claimed_by      uuid REFERENCES users(id),
  claimed_at      timestamptz,
  image_signatures jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_similarity numeric(5,4) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, group_no),
  CHECK (jsonb_typeof(tags) = 'array'),
  CHECK (status <> 'CLAIMED' OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (status = 'CLAIMED' OR claimed_by IS NULL)
);
CREATE INDEX content_groups_pool_idx ON content_groups(status, created_at DESC);
CREATE INDEX content_groups_task_status_idx ON content_groups(task_id, status);
CREATE INDEX content_groups_task_idx ON content_groups(task_id, group_no);
CREATE INDEX content_groups_claimed_idx ON content_groups(claimed_by, claimed_at DESC) WHERE status = 'CLAIMED';
CREATE TRIGGER content_groups_updated_at BEFORE UPDATE ON content_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE content_group_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES content_groups(id) ON DELETE CASCADE,
  source_image_id uuid REFERENCES task_images(id) ON DELETE SET NULL,
  file_path       text NOT NULL,
  thumb_path      text NOT NULL,
  width           integer NOT NULL CHECK (width > 0),
  height          integer NOT NULL CHECK (height > 0),
  angle_variant   varchar(40) NOT NULL,
  crop_variant    varchar(40) NOT NULL,
  garnish_variant varchar(120) NOT NULL,
  light_variant   varchar(40) NOT NULL,
  sort_order      integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, sort_order)
);
CREATE INDEX content_group_images_group_idx ON content_group_images(group_id);

-- ---------------------------------------------------------------------------
-- 后台配置：API 密钥加密保存；Prompt 版本化并仅管理员可见。
-- ---------------------------------------------------------------------------
CREATE TABLE provider_settings (
  kind                text PRIMARY KEY CHECK (kind IN ('TEXT', 'IMAGE')),
  provider            text NOT NULL CHECK (provider IN ('mock', 'openai')),
  base_url            text,
  model               text,
  api_key_ciphertext  text,
  options             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dianping_credentials (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cookies_ciphertext  text,
  version             integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_checked_at     timestamptz,
  last_check_ok       boolean,
  last_check_message  text
);

CREATE TABLE prompt_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('IMAGE', 'COPY')),
  name       varchar(120) NOT NULL,
  version    integer NOT NULL CHECK (version > 0),
  content    jsonb NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);
CREATE UNIQUE INDEX prompt_templates_one_active_idx
  ON prompt_templates(kind) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 通知 / 审计 / Worker 心跳
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       varchar(40) NOT NULL,
  title      varchar(160) NOT NULL,
  body       text NOT NULL,
  task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text,
  action      varchar(80) NOT NULL,
  target_type varchar(40),
  target_id   text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);

CREATE TABLE worker_heartbeat (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker_id     text NOT NULL,
  started_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  processed_total bigint NOT NULL DEFAULT 0
);
