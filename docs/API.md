# API 参考

Base URL：`/api`（开发时由 Vite 代理到 `http://127.0.0.1:4100`；生产时 API 直接提供）。

## 1. 通用约定

### 1.1 成功 / 失败响应

```json
{ "data": { }, "message": "可选的人类可读信息" }
```

```json
{
  "error": {
    "code": "CONTENT_TAKEN",
    "message": "手慢了，这一组刚刚被其他用户领取",
    "details": null,
    "requestId": "uuid"
  }
}
```

- 全部时间字段为 ISO 8601 UTC 字符串，前端按浏览器时区展示。
- 所有列表接口都接受 `page`（默认 1）与 `pageSize`（默认 20，最大 100）。
- 需要登录的接口依赖 HttpOnly Cookie `shiwei_session`；前端请求需带 `credentials: 'include'`。
- 非 GET 请求必须来自同站点；跨站请求返回 403。

### 1.2 常见错误码

| code | HTTP | 含义 |
| --- | ---: | --- |
| `UNAUTHORIZED` | 401 | 未登录 / 会话过期 / 账号停用 |
| `FORBIDDEN` | 403 | 角色或对象权限不足 |
| `NOT_FOUND` | 404 | 资源不存在或无权看到 |
| `VALIDATION_ERROR` | 400 | 参数校验失败 |
| `EMAIL_EXISTS` | 409 | 邮箱已被注册 |
| `INVITE_EXPIRED` / `INVITE_USED` / `INVITE_REVOKED` | 409 | 邀请码不可用 |
| `INVITER_INVITE_DISABLED` | 409 | 邀请人的邀请权限被关闭 |
| `TASK_ALREADY_REVIEWED` | 409 | 任务已被处理 |
| `PROMPT_NOT_ACTIVE` | 409 | Prompt 未激活，无法开始生成 |
| `ALREADY_CLAIMED` / `CONTENT_TAKEN` | 409 | 已领取 / 已被别人领取 |
| `RATE_LIMITED` | 429 | 触发限流 |
| `INTERNAL_ERROR` | 500 | 服务端错误 |

## 2. 认证

### `POST /auth/login`

```json
{ "email": "admin@shiwei.local", "password": "Shiwei@2026" }
```

成功后设置 HttpOnly Cookie。限流：8 次 / 分钟 / IP。

### `POST /auth/register`

```json
{
  "code": "K7M2P9QX4A",
  "email": "new@example.com",
  "displayName": "新食客",
  "password": "至少10位含字母和数字"
}
```

角色由邀请码决定。成功后自动登录。

### `POST /auth/demo-login`

仅 `DEMO_MODE=true` 时可用，接受 `{ "role": "ADMIN" | "AGENT" | "USER" }`。生产环境必须关闭。

### 其他

- `GET /auth/me`：当前用户。
- `POST /auth/logout`：销毁当前会话。
- `POST /auth/change-password`：`{ currentPassword, newPassword }`；成功后注销其他会话并重新签发当前会话。
- `POST /auth/demo-login`：演示入口（见上）。
- `GET /public/config`：公开的品牌与演示模式配置。
- `GET /public/hero-image`：登录页示例图。
- `GET /health`：数据库与 Worker 健康状态。

## 3. 邀请

### `POST /invites`

管理员：

```json
{ "role": "AGENT", "expiresInDays": 7, "maxUses": 1, "note": "上海探店小队" }
```

代理：

```json
{ "role": "USER", "expiresInDays": 3, "maxUses": 2 }
```

- 代理必须 `invite_enabled = true`，且 `role` 只能是 `USER`。
- 普通用户调用始终 403。
- 响应包含 `code` 与可直接分享的 `url`。

### `GET /invites`

管理员查看全部；代理只看自己创建的。支持 `status=ACTIVE|EXPIRED|USED|REVOKED`。

### `GET /invites/check/:code`

公开接口，用于注册页展示邀请人、角色、剩余次数、有效期。返回：

```json
{
  "data": {
    "valid": true,
    "role": "USER",
    "inviterName": "阿岚 · 代理",
    "expiresAt": "2026-10-20T03:07:58.609Z",
    "remainingUses": 2
  }
}
```

### `POST /invites/:id/revoke`

本人或管理员可撤销。

## 4. 任务

### `POST /imports/dianping`（JSON）

代理或普通用户登录后，提交 `{ "text": "大众点评分享文案或 dpurl.cn 链接" }`。服务端优先读取数据库中的共享 Cookie 并解析大众点评页面，未配置时兼容 `DIANPING_PARSER_API_URL`，仅接受大众点评笔记及受信任图片域名，返回 `title`、`body`、`tags`、`coverBase64`、`coverMimeType`、`sourceUrl`。`tags` 仅包含页面原生 `#话题`，不包含 `@提及`；无正文或话题时返回空值/空数组。首图最大 12MB，内置解析直接从受信任图片域下载且不带 Cookie；Cookie 不会返回用户浏览器。此接口只预填素材，不创建任务或绕过人工审核。

### `POST /tasks`（multipart/form-data）

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `generationCount` | 数字 | 10–100 |
| `sourceTitle` | 字符串 | 原始标题，≤200 |
| `sourceBody` | 字符串 | 原始正文，可选，≤8000 字；缺省按空字符串处理 |
| `sellingPoints` | JSON 数组字符串 | 1–8 条，必填 |
| `tags` | JSON 数组字符串 | 原始话题标签，可选，0–12 条；缺省按空数组处理 |
| `images` | 文件（可多个） | 1–6 张，JPG/PNG/WebP，每张 ≤12MB |

示例返回：

```json
{ "data": { "id": "uuid", "taskNo": "T261018-4757", "status": "PENDING_REVIEW" } }
```

管理员不能提交任务。任务创建后进入待审；审核前不会创建生成队列。

### `GET /tasks`

查询参数：`status`、`q`、`page`、`pageSize`。

- 管理员：全部。
- 代理：自己 + 名下普通用户（`invited_by = 代理`）提交的。
- 普通用户：仅自己。

### `GET /tasks/:id`

返回任务、原图元数据、审核信息、队列进度、计数、日志权限标记。**不返回 Prompt 或 API 配置。**

### `GET /tasks/:id/logs`

返回最近 200 条（最多 500 条）生成日志。

### `POST /tasks/:id/review`（管理员）

```json
{ "decision": "APPROVE", "comment": null }
```

```json
{ "decision": "REJECT", "comment": "素材与主题不一致，请补充后重提" }
```

- 只有 `PENDING_REVIEW` 可审核。
- 通过时会校验 Prompt 已激活、Provider 已配置，并生成 `generation_jobs` 与 Prompt 快照。
- 驳回必须填写理由，同时写入站内通知。

### `POST /tasks/:id/void`（管理员）

```json
{ "reason": "素材版权存疑" }
```

未领取的 `STAGED / AVAILABLE` 内容会被下架为 `WITHDRAWN`；已领取内容保留。运行中的队列会标记取消。

### `POST /tasks/:id/retry`（管理员）

仅 `FAILED` 可重试。已生成组会保留，Worker 从缺失组继续。

## 5. 内容池

### `GET /pool`

查询参数：`q`、`sort=latest|oldest`、`page`、`pageSize`。只返回 `AVAILABLE`。字段包含 `groupCode`、`title`、`preview`、`tags`、`coverImageId`、`remaining=1`。

### `GET /pool/:id`

- `AVAILABLE`：任何登录用户可看预览。
- `CLAIMED`：仅领取人 / 管理员可看完整文案。
- `STAGED / WITHDRAWN`：仅管理员。

### `POST /pool/:id/claim`

仅代理 / 普通用户。原子领取；成功后返回组 id 与 code。失败：
- `404`：不存在或已下架。
- `409 CONTENT_TAKEN`：已被其他用户领取。
- `409 ALREADY_CLAIMED`：自己已领取。

### `GET /library`

仅当前用户已领取的内容，返回完整文案与缩略图。

### `GET /content/:id/download`

返回 ZIP。仅领取人与管理员。结构：`Group_XX/image_01.jpg`、`Group_XX/文案.txt`。

### 媒体

- `GET /media/task-images/:id?thumb=1`：原图 / 缩略图；仅管理员、提交者或提交者的代理可见。
- `GET /media/group-images/:id?thumb=1`：可领取内容对所有登录用户可见；已领取内容仅领取人与管理员。

## 6. 管理端

### 用户

- `GET /admin/users?role=&status=&q=&page=`：全部账号。
- `POST /admin/users`：`{ email, displayName, role: "AGENT"|"USER", password?, inviteEnabled? }`；密码留空则返回一次性临时密码。
- `PATCH /admin/users/:id`：`{ status?, inviteEnabled?, displayName? }`。
- `POST /admin/users/:id/reset-password`：`{ newPassword }`，注销该用户所有会话。

### 团队（代理）

- `GET /team/users`：名下普通用户与任务计数。
- `GET /team/overview`：名下用户、待审、完成与邀请开关状态。

### 内容

- `GET /admin/content?status=&q=&page=`：`STAGED | AVAILABLE | CLAIMED | WITHDRAWN` 全量视图、领取归属。

### Prompt

- `GET /admin/prompts`：全部版本。
- `POST /admin/prompts`：`{ kind: "IMAGE"|"COPY", name, content, activate? }`，创建新版本。
- `POST /admin/prompts/:id/activate`：激活。
- `DELETE /admin/prompts/:id`：只能删除未激活版本。

`IMAGE` content 结构：

```json
{
  "positiveTemplate": "含 {{angle}} {{crop}} {{garnish}} {{light}} 占位符",
  "negativeTemplate": "负面约束",
  "outputSize": "1024x1536",
  "variantOptions": {
    "angles": ["小幅度左倾", "..."],
    "crops": ["局部特写", "..."],
    "garnishes": ["...", "..."],
    "lights": ["暖自然光", "..."]
  }
}
```

`COPY` content 结构：

```json
{
  "systemPrompt": "...",
  "userTemplate": "含 {{sourceTitle}} {{sellingPoints}} 等占位符",
  "titleHooks": ["..."],
  "openingLines": ["..."],
  "narrativeStructures": ["场景前置", "..."],
  "tagLibrary": ["..."]
}
```

### Provider

- `GET /admin/providers`：仅掩码与 `hasApiKey`，不返回密文或明文。
- `PUT /admin/providers/:kind`：`kind = TEXT | IMAGE`。

```json
{
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4.1-mini",
  "apiKey": "sk-...",
  "options": { "temperature": 0.92, "jsonMode": true }
}
```

图生图选项示例：

```json
{
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-image-1",
  "apiKey": "sk-...",
  "options": { "size": "1024x1536", "quality": "high", "sendNegativePrompt": false }
}
```

- `POST /admin/providers/:kind/test`：文案会真实调用一次最小请求；图片只做字段校验，避免无意义出图扣费。

### 日志

- `GET /admin/logs/generation?level=&q=&page=`
- `GET /admin/logs/audit?q=&page=`

## 7. 通知 / 工作台

- `GET /notifications?limit=&unread=1`
- `POST /notifications/:id/read`
- `POST /notifications/read-all`
- `GET /dashboard`：按角色返回统计、最近任务、7 日入池趋势、Worker 心跳（管理员）。
- `GET /admin/overview`：管理员概要统计。

## 8. 外部 API 契约

### 文案

请求：`POST {baseUrl}/chat/completions`

```json
{
  "model": "模型名",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.92,
  "max_tokens": 2200,
  "response_format": { "type": "json_object" }
}
```

响应需要兼容：

```json
{
  "choices": [
    { "message": { "content": "{\"title\":\"...\",\"paragraphs\":[\"...\"],\"tags\":[\"...\"]}" } }
  ]
}
```

也支持 `body` 代替 `paragraphs`。`jsonMode` 可在后台关闭。

### 图生图

请求：`POST {baseUrl}/images/edits`，`multipart/form-data`

- `model`
- `prompt`（含负面约束）
- `image`（原图）
- `n`、`size`、`quality`（可选）
- `negative_prompt`（仅在后台开启时）

响应需要兼容：

```json
{
  "data": [
    { "b64_json": "..." }
  ]
}
```

或：

```json
{ "data": [ { "url": "https://..." } ] }
```

系统会对返回图强制做 900×1200 裁切、机检与相似度比较。

## 大众点评 Cookie（仅管理员）

- `GET /api/admin/dianping-cookie`：摘要 `configured/cookieCount/usableCookieCount/expiresAt/updatedAt/lastCheckedAt/lastCheckOk/lastCheckMessage`，不含 Cookie 原值、密文、域名或 Cookie 名。
- `PUT /api/admin/dianping-cookie`：JSON 请求体 `{cookieJson: string}`，字符串内容为浏览器 Cookie 数组或 `{cookies: [...]}`；最大 512 KiB，成功返回摘要。验证失败 400，不更改旧值。
- `DELETE /api/admin/dianping-cookie`：清除凭据并返回未配置摘要。
- `POST /api/admin/dianping-cookie/test`：请求 `{text: string}`，真实调用共享 Cookie 解析，成功返回 `{data:{ok:true,title,message}}`，不创建素材或任务。未导入返回 409；限制 8 次/10 分钟。

以上接口未登录返回 401，普通用户与代理返回 403。到期摘要仅表示已知有效期上限；包含会话 Cookie 时为空。导入后 lastCheckOk=null，只有实际解析才记录检查结果。Cookie 校验接受 `name/value/domain/path/secure/hostOnly/expirationDate` 或 `expires`，按域名过滤，并拒绝头注入；负数有效期作为会话 Cookie。所有请求沿用现有 Origin 校验。
