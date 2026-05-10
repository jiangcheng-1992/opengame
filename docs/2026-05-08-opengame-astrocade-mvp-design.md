# OpenGame × Astrocade Clone — MVP 修正版设计

> 2026-05-10 更新：二创 / Remix 已从当前 MVP 范围移除，详见 `docs/2026-05-10-remove-remix-scope-design.md`。本文只保留一创、游玩、Like、继续修改相关设计为当前依据。

## 1. 修正结论
原始方案方向成立，但不能原样实现。修正版以“先跑通真实生成闭环”为第一目标：匿名用户输入 prompt，后端启动 Vercel Sandbox 运行 OpenGame，完成后把静态游戏上传到 Vercel Blob，详情页用 iframe 播放。

本目录当前是新项目，因此先建立 `AGENTS.md` 和工程骨架，再进入 Vercel / MiniMax / OpenGame 冒烟。

## 2. MVP 范围
- 必做：公共 Gallery、我的作品、创建游戏、生成进度、详情播放、Like、playCount、继续修改。
- 不做：登录、创作者经济、评论、关注、复杂榜单、用户分析、按游戏定制 edit modes。
- 默认匿名身份：`anon_id` httpOnly cookie。

## 3. 技术架构
- 前端：Next.js App Router + Tailwind CSS + lucide-react。
- 数据：Prisma + Postgres。
- 产物：Vercel Blob，保存可播放静态入口和源码包。
- 长任务：Vercel Sandbox 运行 OpenGame；有 `OPENGAME_SNAPSHOT_ID` 时从预构建环境启动，没有 snapshot 时在任务内冷启动安装 OpenGame。
- LLM：MiniMax Token Plan，OpenAI-compatible，`MiniMax-M2.7` 优先，失败时人工切 `MiniMax-M2.7-highspeed`。端点通过 `MINIMAX_BASE_URL` 配置；当前本地密钥实测可用端点是 `https://api.minimaxi.com/v1`。

Function 只负责短逻辑：创建任务、查询进度、finalize、写数据库。当前 Vercel Hobby Node.js Function 可配置到 300s，但生成任务仍放 Sandbox，避免请求生命周期控制长任务。

## 4. 已修正的硬问题
- Sandbox SDK 不使用未经确认的 `name/source.name/fileExists/redirect` 写法。实现侧以 `sandboxId`、snapshotId、`detached`、stream 读写为边界，并把 SDK 差异收敛在 `lib/sandbox.ts`。
- MiniMax 图片接口使用 `POST ${MINIMAX_BASE_URL}/image_generation`，读取 `data.image_urls`。
- OpenGame CLI 不预设 `--continue` / `--out` 存在。继续修改先做能力探测，不支持时降级为“复制源码 + 增量 prompt”。
- 容量估算同时看 Sandbox Active CPU 和 Provisioned Memory。等待 LLM 不计 Active CPU，但 Sandbox 运行时长会占用内存额度。

## 5. 数据模型
核心表：
- `AnonUser`：匿名用户。
- `Game`：游戏作品、状态、playUrl、sourceUrl、父作品、计数。
- `Message`：用户和生成器对话历史。
- `Job`：生成任务、Sandbox ID、日志路径、错误。
- `Reaction`：匿名 Like。
- `UsageBucket`：按 `anon_id` 和 IP 做每日限流。

状态：
- `GameStatus`: `DRAFT | GENERATING | READY | FAILED`
- `JobStatus`: `QUEUED | RUNNING | VALIDATING | REPAIRING | FINISHING | DONE | FAILED`

`READY` 表示游戏已经通过 Sandbox 内浏览器自动试玩验证，不只是产出 `index.html`。

## 6. API
- `GET /api/me`
- `GET /api/games?tab=all|mine&cursor=`
- `GET /api/games/:id`
- `POST /api/games`
- `POST /api/games/:id/messages`
- `POST /api/games/:id/like`
- `POST /api/games/:id/play`
- `GET /api/jobs/:id/progress`
- `POST /api/jobs/:id/finalize`

所有写接口都从 `anon_id` 推导用户，不信任客户端传入 owner。

## 7. 生成流程
1. 用户提交 prompt。
2. API 创建 `Game`、`Message(USER)`、`Job`。
3. API 创建 Sandbox，写入 MiniMax / OpenGame 环境变量，detached 执行 OpenGame。优先使用 `OPENGAME_SNAPSHOT_ID`，失败或缺失时走 `OPENGAME_GIT_URL` 冷启动安装路径。
4. 前端每 2s 轮询进度。
5. 检测到 HTML 产物后，Sandbox 启动 Headless Chromium 自动试玩，进入 `VALIDATING`。
6. 验证加载、console fatal error、点击开始、键盘输入、画面/DOM 状态变化。
7. 自动试玩失败时进入 `REPAIRING`，把验证报告交回 OpenGame 最多修复 2 轮。
8. 通过验证后写入 playable marker，前端进入 `FINISHING`。
9. finalize 读取 Sandbox 产物，上传 Blob，更新 `Game.READY` 和 `Job.DONE`，停止 Sandbox。

OpenGame 本机冒烟实测可能产出 `pong.html` 这类命名，而不是固定 `index.html`。生成命令结束后必须把首个 HTML 文件归一化复制成 `index.html`，但 `index.html` 存在不代表可以发布；只有自动试玩通过后才能上传并设为 `READY`。

Blob 裸 HTML URL 的默认 CSP 会阻止内联脚本执行。详情页 iframe 必须使用同源 `/api/games/:id/files/...` 代理读取 Blob 文件，并在代理响应上设置适合可玩 HTML 的 CSP，避免单文件游戏加载后白屏。

## 8. 继续修改
M1 冒烟先检查 OpenGame 是否支持原生 continue。若支持，继续修改在源目录上执行增量 prompt。若不支持，MVP 降级为：
- 继续修改：创建新 Job，优先恢复当前 `sourceUrl` 源码包并尝试 `--continue`，同时在 prompt 中附带最近消息和源码摘要。
- 源码上下文超过上限时截断，并提示“会尽量保留核心玩法”。
- 继续修改会覆盖同一作品的 Blob 产物；失败时旧版本继续可玩。

## 9. 限流与失败
- 每 `anon_id` 每天 10 次生成任务。
- IP 兜底每天 30 次生成任务。
- Sandbox 创建失败、OpenGame 启动失败、MiniMax 401/429、30min 超时、finalize 失败都写入 `Job.errorMsg`。
- 用户关页后可重新进入详情页继续轮询。

## 10. 必跑验证
- `npx prisma generate`
- `npm run lint`
- `npm run build`
- 涉及 `JobStatus` 枚举变更后，对目标数据库执行 Prisma schema 同步，例如本地开发库运行 `npx prisma db push`。
- 有凭据后执行 `npm run smoke:opengame` 和 `npm run smoke:sandbox`。
- 真链路生成后确认日志出现 `Playable validation passed`，再访问详情页确认同源 iframe 可点击开始并响应键盘。
- 本地启动后访问首页、创建页、详情页，确认布局无明显错位。
