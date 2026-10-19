# 拾味内容中台 · 交接说明

> 交接版本：2026-10-18 · 代码与文档快照  
> 本包不包含任何 `.env`、真实 API Key、生产数据库或用户上传文件。

## 1. 接手前先看什么

按顺序读：

1. [README.md](README.md) — 启动、部署、角色、验收方式。
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 数据模型、状态机、领取锁、邀请逻辑、队列重试。
3. [docs/API.md](docs/API.md) — 所有接口与外部模型契约。
4. [docs/ACCEPTANCE-REPORT.md](docs/ACCEPTANCE-REPORT.md) — 最近一次 51 项端到端验收结果。
5. [docs/OPEN_SOURCE_EVALUATION.md](docs/OPEN_SOURCE_EVALUATION.md) — 为什么不直接使用现成 CMS。

## 2. 当前状态

- 系统闭环已完成：提交 → 审核 → 异步生成 → 公共池 → 独占领取 → ZIP 下载。
- 角色隔离、邀请开关、Prompt 版本化、API Key 掩码、审计与生成日志已完成。
- 最近验收：**51 / 51 通过**，10 组素材生成、并发领取、权限、邀请和下载均通过。
- 当前生成使用 **mock 演示适配器**，未接入任何真实付费模型。接口适配层已经实现，只需要在管理员后台配置真实 Provider。
- 新增大众点评导入：提交素材页通过独立的小生清流解析服务预填标题、首图及可用的正文、`#话题`；正文和原始标签可留空。本包不包含 Cookie，需在解析服务端单独配置，拾味端设置 `DIANPING_PARSER_API_URL`。导入不绕过人工审核；已有数据库升级需运行 `pnpm db:migrate`。
- 餐盘变形的视觉复核尚未接入 VLM；目前依赖提示词、3:4 归一化、清晰度/信息量机检和相似度过滤。详见 README「已知限制」。

## 3. 新环境启动清单

```bash
# 1. 安装依赖
pnpm install

# 2. 生成本地配置
cp .env.example .env
openssl rand -base64 32        # 填入 ENCRYPTION_KEY

# 3. 初始化数据库
pnpm db:migrate
pnpm db:seed
pnpm dev

# 可选：若要测试大众点评导入，还需启动已配置 Cookie 的小生清流解析服务
# 并在 .env 中设置 DIANPING_PARSER_API_URL=http://127.0.0.1:8051/api/v1

# 或 Docker
cp .env.docker.example .env.docker
# 填写 POSTGRES_PASSWORD、ENCRYPTION_KEY、SEED_PASSWORD
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker exec api node dist/server/cli/seed.js
```

启动后立即修改 seed 账号密码；对外部署必须：

- `DEMO_MODE=false`
- `PUBLIC_ORIGIN=https://你的域名`
- 使用 HTTPS 反向代理
- 把 `.env` / `.env.docker` 排除在 Git 之外，并使用独立密钥
- 不要把演示数据当成真实用户数据

## 4. 必须向原负责人确认的信息

- 真实图生图与文案供应商、是否兼容 OpenAI-compatible、Base URL / 模型名 / 密钥由谁持有。
- 业务域名、部署机器、PostgreSQL 数据保留策略、上传文件备份策略。
- 是否继续使用当前品牌「拾味」和 UI，还是换品牌色/Logo。
- 是否有真实代理 / 用户账号需要迁移；本包不包含任何线上数据库。
- 合规责任人与平台分发策略。系统只提供变体工具，不保证平台过审。

## 5. 接手后的建议顺序

1. 在本机跑通 `pnpm acceptance`，确认 51 项全绿。
2. 在管理员「API 接入」切换真实 Provider，用 10 组测试素材重跑生成。
3. 接入视觉模型做餐盘结构复核（可选，但建议；当前无 VLM 凭证，未接入）。
4. 接入对象存储或定期备份 `DATA_DIR` / PostgreSQL volume。
5. 配置 HTTPS、域名、日志轮转和数据库备份。
6. 删除或停用演示账号，修改所有密码。

## 6. 几个容易踩的坑

- **不要只删 `node_modules` 就交差**：`pnpm-lock.yaml` 和 `package.json` 的 `packageManager` 已固定，保证可复现安装。
- **Worker 必须单独运行**：只启动 API 时，审核通过的任务只会停在队列里。
- **上传与生成文件在本地卷**：多机部署时必须共享数据卷或改对象存储；API 与 Worker 都要能访问。
- **API 与 Worker 共用数据库**，不要为 Worker 单独建库。
- **Prompt 修改必须激活新版本**；生成任务使用审批时写入的快照，不会受后台后续编辑影响。
- **领取使用数据库条件 UPDATE**，不要改回「先查再改」，会破坏独占语义。
- **代理邀请权限是独立开关**，关闭后其未使用邀请码也会暂停注册。
- **演示生成器不调用外部 API**；切换真实 Provider 前，不要用演示结果评估 AI 出图质量。

## 7. 校验包

包含 `SHA256SUMS`，解压后可执行：

```bash
shasum -a 256 -c SHA256SUMS   # macOS
sha256sum -c SHA256SUMS       # Linux
```

原包已在本地解压后校验通过；随后新增大众点评导入功能并更新了代码与文档。工作目录里的旧校验清单仅证明原包原貌；如需转交修改后的版本，运行 `pnpm package:handoff`，脚本会重新生成校验清单并排除本地密钥、数据库和依赖目录。
