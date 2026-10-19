# 拾味内容中台

> 探店素材批量变体 · 人工审核 · 公共内容池 · 独占领取

> 交接给别人？先看 [HANDOFF.md](HANDOFF.md)。

一套可直接运行的探店种草矩阵内容工作流：代理 / 用户上传原图与原始文案，管理员审核通过后，系统调用外部图生图与文案大模型批量生成变体，全部进入公共内容池；**每组内容只允许一个用户领取**，领取后下架并可下载 ZIP。

![工作台](docs/screenshots/dashboard-admin.png)

## 已实现

- **三级权限**：管理员 / 代理 / 普通用户；对象级授权，不只是菜单隐藏。
- **邀请体系**：管理员可邀请代理与用户；代理只能邀请普通用户；邀请开关实时控制；普通用户无邀请入口。
- **人工审核闸门**：未审核任务不创建队列、不调用任何外部 API；通过 / 驳回（必填理由）/ 作废 / 失败重试。
- **异步生成队列**：Postgres `FOR UPDATE SKIP LOCKED` + 独立 Worker；超时、重试、心跳恢复、逐组日志。
- **外部 API 可配置**：OpenAI-compatible 文本与图生图接口；密钥 AES-256-GCM 加密存储，仅管理员可访问。
- **Prompt 管理**：仅管理员可见；版本化、激活、删除；审批时写入任务快照，运行中不被后台编辑影响。
- **图片约束**：强制 900×1200（3:4）；L 倾斜 / 景别 / 配菜重排 / 光影随机组合；空间相关相似度过滤。
- **文案约束**：三段式约 200 字；填写的卖点会全部保留；卖点与原始话题标签均可留空，文案仍从管理员标签库生成话题；标题与标签组合批次内唯一；4-gram Jaccard 相似度过滤。
- **独占领取**：数据库单条条件 UPDATE 原子锁，已被两个真实用户并发验证 `200×1 / 409×1`。
- **内容池 / 我的领取**：预览、标签、剩余可领取；领取后立即下架；ZIP 含 `Group_XX/图片 + 文案.txt`。
- **管理后台**：任务、内容、用户、邀请、Prompt、API、生成日志、审计日志、Worker 心跳。
- **端到端验收**：`51/51` 全部通过，报告见 [ACCEPTANCE-REPORT.md](docs/ACCEPTANCE-REPORT.md)。
- **大众点评链接导入**：提交素材页可粘贴 `dpurl.cn` 或 `m.dianping.com/feeddetail/…`，自动填入标题、首图、正文与页面 `#话题`；正文和原始标签可留空；管理员可在 API 接入页维护大众点评 Cookie JSON，其他用户直接粘贴链接，导入不会自动提交审核。

## 角色与核心规则

| 能力 | 管理员 | 代理 | 普通用户 |
| --- | :---: | :---: | :---: |
| 邀请代理 / 普通用户 | ✅ / ✅ | ❌ / ✅（需开关） | ❌ / ❌ |
| 提交素材任务 | ❌ | ✅ | ✅ |
| 审核 / 驳回 / 作废 | ✅ | ❌ | ❌ |
| 浏览公共池 | ✅（只读） | ✅ | ✅ |
| 领取 / 下载 ZIP | ❌ | ✅ | ✅ |
| API Key / Prompt | ✅ | ❌ | ❌ |

**成品不属于提交者。** 审核通过并生成完成后，内容全部进公共池；提交任务的代理或用户也要像所有人一样领取。

## 界面

> 截图来自本地 `DEMO_MODE=true` 演示环境；生产部署会关闭一键演示登录。更多截图在 [docs/screenshots](docs/screenshots)。

| 公共内容池 | 管理员 Prompt 版本 |
| --- | --- |
| ![内容池](docs/screenshots/pool-user.png) | ![Prompt](docs/screenshots/prompts-admin.png) |

| API 接入 | 我的领取 |
| --- | --- |
| ![API 接入](docs/screenshots/settings-admin.png) | ![我的领取](docs/screenshots/library-user.png) |

## 架构

```text
浏览器 React 19 + Vite
        │ Cookie / JSON / multipart
        ▼
Fastify API ────────────────┐
        │ SQL                │ 静态托管 dist/web
        ▼                    │
   PostgreSQL 17             │
        ▲                    │
        │ SKIP LOCKED        │
   Worker 进程 ──→ 外部文案 API
        │      └──→ 外部图生图 API
        ▼
本地卷 uploads / generated
```

数据表、状态机、并发领取 SQL、邀请流程、Prompt 版本与外部 API 契约见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)；完整接口见 [API.md](docs/API.md)。

## 技术选型

没有硬套一个功能不匹配的 CMS。评估了 Directus、Payload、Refine、Twenty、Supabase、Nhost，结论与对比见 [OPEN_SOURCE_EVALUATION.md](docs/OPEN_SOURCE_EVALUATION.md)。

最终使用成熟基础设施组合：**Fastify 5 + PostgreSQL 17 + React 19 + Sharp + Archiver + Pino + Argon2id**。核心队列与独占领取是约 10 张表的领域层，约 200 行，可审计、可测试。

## 快速开始（本地）

### 前置

- Node.js 22+
- pnpm 10+
- PostgreSQL 16/17（本机 5432）

### 1. 安装

```bash
git clone <repo> && cd 大众点评3
pnpm install
createdb shiwei_content_pool
```

### 2. 配置

```bash
cp .env.example .env
openssl rand -base64 32   # 填入 ENCRYPTION_KEY
```

最小 `.env`：

```dotenv
NODE_ENV=development
PORT=4100
PUBLIC_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://<user>@127.0.0.1:5432/shiwei_content_pool
ENCRYPTION_KEY=<32字节base64>
DATA_DIR=./data
WEB_DIST=./dist/web
DEMO_MODE=true
ADMIN_EMAIL=admin@shiwei.local
DEMO_PASSWORD=Shiwei@2026
WORKER_POLL_MS=800
DIANPING_PARSER_API_URL=http://127.0.0.1:8051/api/v1
```

### 3. 初始化与启动

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web：<http://localhost:5173>
- API：<http://127.0.0.1:4100/api/health>

`pnpm dev` 同时启动 API、Worker 与 Vite。

### 大众点评 Cookie 维护与解析

管理员进入 **API 接入 → 大众点评 Cookie 维护**，导入浏览器登录大众点评后导出的 Cookie JSON，支持 Cookie 数组和包含 `cookies` 数组的对象，最大 512 KiB。点击保存后，完整 Cookie 数组使用现有 `ENCRYPTION_KEY` 进行 AES-256-GCM 加密，存入 PostgreSQL；页面只显示条数、已知有效期、更新时间和最近解析结果。Cookie 过期后重新导入即可替换，无需重启。无效 JSON、其他网站 Cookie 或全部过期的导入不会覆盖原配置。

导入只表示已保存，**不代表登录已通过验证**。管理员可粘贴一条可访问的笔记链接，点击“测试解析”。普通用户和代理仍在提交素材页粘贴分享文案或链接，后端会读取数据库中最新的 Cookie，预填标题、首图、正文和页面 `#话题`，不需要用户提供 Cookie。`bizType`、`sceneType` 等查询参数保持原样。Cookie 仅发送给匹配域名、路径、协议和有效期的页面请求；首图请求不携带 Cookie。

新增迁移 `003_dianping_credentials`（共享Cookie）及 `004_optional_selling_points`（允许空卖点）会由 Docker API 启动自动执行；本机开发需执行 `pnpm db:migrate`。请保留原 `ENCRYPTION_KEY`，否则已保存的 Cookie 无法解密。清除按钮会停止使用已保存的 Cookie。未配置数据库 Cookie 时，仍可使用原 `DIANPING_PARSER_API_URL` 独立服务作为兼容路径；该服务需自行维护登录凭据。

内置页面解析支持结构化 JSON、Qwik 数据和标准 OG 元信息，识别返回 HTTP 200 的登录页，并对登录失效、验证页、笔记不可访问给出提示。真实登录成功页面仍需管理员导入自己的 Cookie 并使用真实笔记完成测试；目前回归验证采用固定测试样本，不把模拟数据当作站点实测。运行 `pnpm test:dianping` 可检查 Cookie 校验、权限、页面提取、域名/重定向边界和共享凭据更新行为。

数据库集成测试使用自动创建并清理的隔离测试库，不改动当前业务库。Docker 运行后可执行：

```powershell
docker compose --env-file .env.docker cp scripts/test-dianping-cookie.integration.cjs api:/app/test-dianping-cookie.integration.cjs
docker compose --env-file .env.docker exec -T api node /app/test-dianping-cookie.integration.cjs
```

### 演示账号

`DEMO_MODE=true` 时，登录页可一键进入：

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| 管理员 | `admin@shiwei.local` | `Shiwei@2026` |
| 代理 | `agent@shiwei.local` | `Shiwei@2026` |
| 用户 A | `user-a@shiwei.local` | `Shiwei@2026` |
| 用户 B | `user-b@shiwei.local` | `Shiwei@2026` |

> 生产部署请设置 `DEMO_MODE=false` 并更换全部密码。

## 生产部署（Docker）

```bash
cp .env.docker.example .env.docker
# 填写 POSTGRES_PASSWORD、ENCRYPTION_KEY（openssl rand -base64 32）、SEED_PASSWORD

docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker exec api node dist/server/cli/seed.js
```

打开 `http://localhost:4100`（以 `.env.docker` 中的 `APP_PORT` 为准，当前本机实例为 `4200`）。Compose 默认只把端口绑定在 `127.0.0.1`，避免把演示后台暴露到局域网。

- `api` 启动时自动执行数据库迁移，随后托管前端。
- `worker` 在 API 健康后启动，独立消费生成队列。
- `app_data` 卷保存上传与生成文件，`pg_data` 保存数据库。
- 放在反向代理后时，将 `PUBLIC_ORIGIN` 改成真实的 **https** 域名，Cookie 会自动加 `Secure`；如需公网访问，自行调整端口绑定或接入代理。
- `.env.docker` 被 Git 忽略；当前本机演示实例使用 `ADMIN_EMAIL=admin@shiwei.local` 与 `.env.docker` 中的 `SEED_PASSWORD`。演示结束请立即改密。

### 常用运维命令

```bash
docker compose --env-file .env.docker logs -f api worker
docker compose --env-file .env.docker restart worker
docker compose --env-file .env.docker exec api node dist/server/cli/migrate.js
```

## 接入真实图生图 / 文案 API

以管理员登录 → **API 接入**：

| 配置 | 说明 |
| --- | --- |
| Provider | `mock`（演示）或 `openai`（OpenAI-compatible） |
| Base URL | 填到 `/v1`，例如 `https://api.openai.com/v1` |
| 模型 | 文案如 `gpt-4.1-mini`；图片如 `gpt-image-1` 或兼容模型 |
| API Key | 加密入库，页面只显示掩码 |

接口契约与请求 / 响应示例见 [API.md §8](docs/API.md#8-外部-api-契约)。图片接口需要兼容 `POST /images/edits`，返回 `b64_json` 或 URL。

切换真实 Provider 后，建议：
1. 先确认 API 账户额度与速率限制。
2. 在 **Prompt 模板** 检查生图正向 / 负向提示词与标签库。
3. 用 10 组任务跑通一次；查看生成日志的重试与相似度拒绝情况。
4. 按供应商能力调整 `size`、`quality` 与并发。

## 验收

```bash
# 方式 A：本机开发栈（API 默认 4100）
ALLOW_DB_RESET=true pnpm db:reset
pnpm db:seed
pnpm acceptance

# 方式 B：对已运行的 Docker 部署验收（当前实例 4200）
BASE_URL=http://127.0.0.1:4200 \
DEMO_PASSWORD=<SEED_PASSWORD> \
ADMIN_EMAIL=<ADMIN_EMAIL> \
pnpm acceptance
```

> 验收脚本会创建 10 组内容、2 个驳回/作废任务，并留下可用于界面演示的数据。

最近一次结果（2026-10-18）：

- **51 / 51 通过**
- 10 组生成：9.1 秒（演示适配器，Docker 部署环境）
- 文案最大 4-gram 相似度：**0.489**（阈值 0.80）
- 图片最大空间相关：**0.798**（阈值 0.985）
- 并发领取：`200×1, 409×1`
- 非领取人下载：`403`；非领取人查看媒体：`404`
- 驳回、作废、邀请开关、Prompt 版本化、直建账号均通过

完整证据：[ACCEPTANCE-REPORT.md](docs/ACCEPTANCE-REPORT.md) / [acceptance-report.json](docs/acceptance-report.json)

## 项目结构

```text
server/
  app.ts               Fastify 装配、鉴权钩子、错误处理、静态托管
  worker.ts            独立 Worker 心跳 / 队列循环
  schema.sql           PostgreSQL DDL 与约束
  cli/                 迁移、种子、重置
  routes/              auth / invites / tasks / pool / users / prompts / misc
  services/            session / tasks / generation / providers / prompts /
                       pool / users / dashboard / similarity / storage
client/src/
  pages/               15 个页面（登录、工作台、任务、内容池、后台等）
  components/          AppShell、UI 原子组件、AuthLayout
  api/  auth/  lib/
scripts/acceptance.ts  51 项端到端验收
docs/                  架构、API、开源评估、验收报告、截图
```

## 安全与合规

- Session 不透明 Token + Argon2id + HttpOnly / SameSite / Secure Cookie + Origin 校验。
- API Key AES-256-GCM 加密；接口永不回传。
- Prompt 与 Provider 路由全部管理员角色校验；任务 / 日志 / 内容池不会泄漏 Prompt。
- 上传校验格式、尺寸、数量；Sharp 重新编码并剥离 EXIF；媒体与下载均做对象级授权。
- 邀请码有有效期、次数、撤销和邀请人开关校验，并有限流。
- 领取使用数据库原子条件更新，不依赖前端状态。
- 合规提示覆盖登录、提交与页脚：**平台风控会检测同源批量素材，系统仅提供变体工具，不保证平台审核通过，分发责任由使用者承担。**

## 已知限制

1. 验收使用内置 **演示适配器**；真实 API 效果需接入密钥后用 10 组重新验收。
2. 餐盘结构校验当前是「提示词约束 + 尺寸 / 清晰度 / 信息量机检 + 相似度过滤」。生产建议增加视觉大模型质检节点（`plate_deformed`）——本次因无可用真实 VLM 凭证未接入，避免交付未经验证的付费调用。
3. 自动去水印依赖供应商执行提示词，无法保证所有模型。
4. 邮件通知未接入，当前为站内通知。
5. 进程内限流适用于单 API 实例；横向扩展 API 时应换 Redis。

## 唯一需要你确认的事

**真实图生图与文案模型用哪一家、是否满足 OpenAI-compatible 契约。** 在提供接口与密钥之前，系统以演示适配器完成全流程验收；不把「演示生成」伪装成真实 AI 效果。接入只需要管理员在「API 接入」中切换 Provider，不需要改代码。
