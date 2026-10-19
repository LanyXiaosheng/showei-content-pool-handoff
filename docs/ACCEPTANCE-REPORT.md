# 拾味内容中台 · 端到端验收报告

- 执行时间：2026-10-18 11:31:45 — 11:31:55（Asia/Shanghai）
- 目标环境：http://127.0.0.1:4200
- 本次任务号：T261018-E1CC
- 结果：**全部通过**（51/51）
- 生成用时：9.1 秒
- 文案最大相似度：0.4887（阈值 0.80）
- 图片最大空间相关：0.7984（阈值 0.985）
- 平均文案长度：226 字

> 说明：本次验收使用系统内置演示适配器（`mock`）生成变体，未调用付费外部 API。真实 API 接入只需在管理员「API 接入」中切换 Provider 并填写密钥；超时、重试、质量卡口与相似度过滤共用同一链路。

| 结果 | 模块 | 验收项 | 证据 |
|---|---|---|---|
| ✅ | 环境 | API 与数据库健康 | status=ok, db=ok |
| ✅ | 环境 | 生成 Worker 在线 | worker=online, lastSeen=2026-10-18T03:31:45.065Z |
| ✅ | 权限 | 三级角色均可登录 | 管理员 / 代理 / 用户 A / 用户 B |
| ✅ | 任务流程 | 代理提交任务后状态为待审核 | taskNo=T261018-E1CC, status=PENDING_REVIEW |
| ✅ | 任务流程 | 审核前无生成队列 | job=null |
| ✅ | 任务流程 | 审核前不调用生成 API、不产生内容 | {"available":0,"claimed":0,"withdrawn":0,"generatedImages":0} |
| ✅ | 任务流程 | 审核前公共池没有该任务内容 | content=0 |
| ✅ | 任务流程 | 管理员审核通过后进入排队 | status=QUEUED |
| ✅ | 任务流程 | 10 组全部生成完成 | status=COMPLETED, available=10, 用时=9.1s |
| ✅ | 可观测性 | 生成日志记录了启动、逐组生成和完成 | JOB_SUCCEEDED, GROUP_GENERATED, IMAGE_DUPLICATE_REJECTED, JOB_STARTED |
| ✅ | 权限 | 任务日志不向代理泄漏 Prompt 变体参数 | meta sanitized for non-admin |
| ✅ | 内容池 | 10 组内容全部进入内容池 | groups=10 |
| ✅ | 内容池 | 内容初始状态为可领取 | AVAILABLE |
| ✅ | 内容池 | 公共池可领取数量增加 10 | 0 → 10 |
| ✅ | 核心规则 | 提交任务的代理不会自动获得成品 | agent library total=0 |
| ✅ | 输出打包 | 每组 ZIP 含 Group_XX 文件夹、图片与独立 txt | 已校验 10 个 ZIP |
| ✅ | 图片 | 全部变体图强制输出 900×1200（3:4） | images=10, ratio=0.75 |
| ✅ | 文案 | 10 份文案三段式、保留全部卖点、标题/标签组合唯一 | 平均 226 字，最大相似度 0.4887 |
| ✅ | 文案 | 文案差异明显，无大面积重复 | max 4-gram Jaccard = 0.489（阈值 0.80） |
| ✅ | 图片 | 不存在高度雷同图片 | 最大空间相关=0.798（阈值 0.985），最小=0.091 |
| ✅ | 领取核验 | 用户 A 可成功领取第 1 组 | SW-261018-E1CC-01 → user A |
| ✅ | 领取核验 | 领取后内容进入用户 A 的「我的领取」 | library total=1 |
| ✅ | 领取核验 | 用户 B 看不到已被领取的组 | GET /pool/:id → 404 |
| ✅ | 领取核验 | 用户 B 无法重复领取 | 409 CONTENT_TAKEN |
| ✅ | 核心规则 | 已领取内容立刻从公共池下架 | available=9 |
| ✅ | 并发领取 | 两名用户并发抢同一组，只有一人成功 | 200×1, 409×1, winner=user A |
| ✅ | 下载 | 领取人可下载 ZIP | status=200, bytes=157790 |
| ✅ | 下载 | 非领取人无法下载 | status=403 |
| ✅ | 下载 | ZIP 包含 Group_XX 图片与文案 | Group_01/文案.txt, Group_01/image_01.jpg |
| ✅ | 权限 | 领取后图片媒体资源仅领取人可访问 | owner=200, other=404 |
| ✅ | 权限 | 代理/普通用户无法访问 API 密钥与 Prompt | 403 × 3 |
| ✅ | 权限 | 普通用户没有邀请入口/能力 | 403 |
| ✅ | 权限 | API 密钥仅返回掩码，不返回密文/明文 | providers=2, masked=true |
| ✅ | 权限 | 任务接口不泄漏 Prompt 内容 | done |
| ✅ | 权限 | Prompt 管理接口仅管理员可用 | prompt versions=2 |
| ✅ | 邀请 | 代理在开关开启时可创建普通用户邀请码 | code=EV8UCNAR9Z |
| ✅ | 邀请 | 代理不能邀请代理 | 403 |
| ✅ | 邀请 | 管理员关闭邀请开关后代理不能创建，已有码暂停 | valid before=true, after=false |
| ✅ | 邀请 | 邀请码注册成功且角色由邀请决定 | email=accept-mvd9r4nh@shiwei.local, role=USER |
| ✅ | 邀请 | 通过邀请注册的普通用户仍无邀请能力 | 403 |
| ✅ | 邀请 | 管理员可邀请代理，新代理默认无邀请权限 | email=agent-mvd9r4nh@shiwei.local, role=AGENT, inviteEnabled=false |
| ✅ | 邀请 | 管理员开通后代理才能邀请普通用户 | blocked=403, afterGrant=USER |
| ✅ | 审核 | 管理员驳回任务并填写理由 | status=REJECTED |
| ✅ | 审核 | 被驳回任务不产生内容、不调用生成 | content=0 |
| ✅ | 通知 | 驳回结果通知提交者 | notifications=3 |
| ✅ | 状态 | 管理员可作废任务 | withdrawn=0 |
| ✅ | Prompt | 管理员可创建/激活/删除版本，历史版本不受影响 | created=85755f8b-d7f1-461c-be4e-d1d86886293d, restored=v1 |
| ✅ | 账号 | 管理员可直接创建普通用户并返回一次性密码 | email=direct-mvd9r4nh@shiwei.local |
| ✅ | 账号 | 直建账号可用临时密码登录 | login=200 |
| ✅ | 账号 | 停用账号无法登录 | login=403 |
| ✅ | 权限 | 未登录访问受保护接口被拒绝 | status=401 |

## 指标

```json
{
  "taskNo": "T261018-E1CC",
  "contentPoolBefore": 0,
  "generationSeconds": 9.1,
  "groupCount": 10,
  "contentPoolAfter": 10,
  "zipBytes": 157790,
  "imageCount": 10,
  "averageCopyLength": 226,
  "maxTextSimilarity": 0.4887,
  "maxImageCorrelation": 0.7984,
  "minImageCorrelation": 0.091,
  "claimedGroup": "SW-261018-E1CC-01",
  "concurrentWinner": "user A"
}
```

## 结论

核心业务闭环、独占领取、权限隔离、邀请开关、Prompt 版本化与下载打包均通过自动化验收。
