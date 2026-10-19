# 开源方案评估与选型

> 评估日期：2026-10-18。Star 数为当日 GitHub API 返回值，仅用于判断社区活跃度，不代表质量结论。
> 结论先行：**没有找到一个同时覆盖「三级 RBAC + 邀请码注册 + 人工审核 + 异步生成队列 + 公共资源池 + 独占领取锁 + 外部 API 编排」的成熟完整应用。**
> 因此没有硬套 CMS / Admin 框架，而是在成熟基础设施库上实现本项目特有的领域层。

## 1. 检索目标

需求要求检索具备以下能力的开源项目：

- 管理员 / 代理 / 普通用户三级 RBAC
- 邀请码注册，且邀请权限可被管理员开关
- 异步任务队列、人工审核闸门
- 公共内容池与「一组内容只能被一人领取」的原子锁
- 可配置外部图生图 / 文本大模型 API
- 后台 Prompt 模板与密钥严格隔离

真实业务里最难替换的不是「后台表格」，而是以下三条领域不变量：

1. **审核通过之前不得产生 API 调用。**
2. **生成完成的内容不属于提交者，全部进入公共池。**
3. **同一组内容在并发下只能被一个用户领取。**

通用 CMS / Admin 框架通常能提供 1 的前半段（内容审核）和权限表，但不会原生提供 2、3 以及生成队列。若通过插件或生命周期钩子硬接，反而会把核心业务分散到框架事件中，难审计、难测试。

## 2. 候选项目对比

| 项目 | Stars | License | 可复用能力 | 与本需求的缺口 | 结论 |
| --- | ---: | --- | --- | --- | --- |
| [Directus](https://github.com/directus/directus) | 38.5k | BSL（GitHub 标记 NOASSERTION） | 数据建模、RBAC、Flows、Admin UI、文件管理 | 无「独占领取」领域模型；Flows 做生成队列与重试会形成难审计的黑盒；商业使用需核对 BSL 条款 | 不整包采用 |
| [Payload CMS](https://github.com/payloadcms/payload) | 45.3k | MIT | TypeScript、Auth、RBAC、Admin UI、Hooks | Next.js 全栈心智；无资源池领取锁；后台任务需外挂 Worker；中文运营 UI 与 Prompt 隔离需大量改造 | 不整包采用 |
| [Refine](https://github.com/refinedev/refine) | 35.9k | MIT | React Admin 页面脚手架、数据 Provider | 只有前端层，不含后端 / 邀请 / 队列 / 领取锁 | 可参考，不采用 |
| [Twenty](https://github.com/twentyhq/twenty) | 58.5k | 自定义（NOASSERTION） | CRM 级权限、对象建模、UI | 领域是 CRM，不是内容池；改造成本高于重写 | 不采用 |
| [Supabase](https://github.com/supabase/supabase) | 111.7k | Apache-2.0 | Postgres、Auth、RLS、Storage | 邀请码三级角色、审核、任务队列、内容池均需自建；自托管组件多，体量偏重 | 仅参考 RLS / Auth 思路 |
| [Nhost](https://github.com/nhost/nhost) | 9.4k | MIT | Postgres、Auth、Storage、GraphQL | 同上；本项目不需要 GraphQL 层，引入后增加运维面 | 不采用 |

高 Star 项目并非不能做，而是**其抽象中心与本项目的核心不变量不重合**：

- CMS 的抽象中心是「内容条目」，不是「一次领取权」。
- CRM 的抽象中心是「销售对象」，不是「生成批次」。
- Auth 平台的抽象中心是「身份」，不是「一组内容只归一人」。

## 3. 最终组合

领域层自研（体量很小，约 10 张核心表），安全、协议、图像、打包交给成熟库：

| 层 | 选型 | 理由 |
| --- | --- | --- |
| HTTP | Fastify 5 | 轻、成熟、插件生态足够；独立于前端部署 |
| DB | PostgreSQL 17 | 事务、唯一约束、`FOR UPDATE SKIP LOCKED`、JSONB 一站式 |
| 队列 | `generation_jobs` 表 + 独立 Worker | 低流量场景无需 Redis；任务状态必须对管理员可见、可审计；失败可恢复 |
| 鉴权 | 自建 Session（HttpOnly Cookie）+ Argon2id | 角色只有三级；不引入完整身份平台；会话可即时注销 |
| 图像 | Sharp | 解码校验、3:4 归一化、EXIF 清理、变体裁切、指纹与 ZIP 缩略图 |
| 打包 | Archiver | 流式 ZIP；UTF-8 文件名 |
| 前端 | React 19 + Vite + TanStack Query | 运营台交互密度高；避免 Next.js 前后端耦合 |
| 日志 | Pino + DB 业务日志 + 审计表 | API 调用重试与人工操作分层留痕 |
| 加密 | Node crypto AES-256-GCM | API Key 加密落库；不引入 KMS 依赖 |

## 4. 为什么没有直接用「队列库」

`pg-boss`、Graphile Worker 都是成熟方案，本可以替代约 200 行队列代码。未采用的原因不是要造轮子，而是：

- 本需求需要把「任务状态 / 队列状态 / 每组进度 / 内容发布」展示在同一个后台，且管理员要能作废、重试、查看逐组日志。
- 这些不是队列的内部状态，而是**领域状态**。把来源放在外部队列会让后台状态与队列状态出现两份事实。
- 当前队列持久化在 Postgres 中，使用 `FOR UPDATE SKIP LOCKED`，规模在单机 / 小团队场景远未触及瓶颈；未来如 QPS 上升，可保持 API 不变，替换执行层。

同样，没有引入 Redis：领取锁不需要它（数据库条件更新足够），队列也不需要它（Postgres 行锁足够）。不引入一个需要额外运维的一致性组件，是这里更稳妥的选择。

## 5. 参考与引用

- Directus：<https://github.com/directus/directus>
- Payload：<https://github.com/payloadcms/payload>
- Refine：<https://github.com/refinedev/refine>
- Twenty：<https://github.com/twentyhq/twenty>
- Supabase：<https://github.com/supabase/supabase>
- Nhost：<https://github.com/nhost/nhost>
- PostgreSQL `SKIP LOCKED`：<https://www.postgresql.org/docs/current/sql-select.html>
