# OpenGame Studio

OpenGame × Astrocade 风格的内部 MVP：输入 prompt，生成可玩的 HTML5 游戏，并支持公共 Gallery、我的作品、详情播放、继续修改和 Like。

## 生产环境

- 当前公开生产入口：`https://opengame.zz-fancy.cloud`。Vercel 每次生产部署仍会生成对应的 `*.vercel.app` 地址，但对外验证优先使用这个别名。
- 页面访问监控使用 Vercel Web Analytics：代码侧已在全局布局接入 `@vercel/analytics`，生产部署后在 Vercel Project 的 Analytics 页面查看访客、页面浏览、来源、地区、设备和浏览器数据。
- 2026-05-10 已确认 Vercel Production 配置了 `GITHUB_DISPATCH_TOKEN`，创建作品后会即时触发 GitHub Actions `opengame-generate.yml`，创建页或修改工作台的生成日志应出现 `Queued GitHub Actions workflow ... @main`。
- 如果线上生成日志退化为 `Queued for the next scheduled GitHub Actions worker run.`，优先检查 `GITHUB_DISPATCH_TOKEN` 是否缺失或过期；修复环境变量后必须重新 `vercel deploy --prod`，旧部署不会自动读取新值。

## 本地启动

1. 使用 Node.js 20 或更高版本
2. 安装依赖：`npm install`
3. 配置环境变量：复制 `.env.example` 为 `.env`，填入真实值；本地默认会自动启动 GitHub 兼容 worker，不需要 `GITHUB_DISPATCH_TOKEN`
4. 生成 Prisma Client：`npm run prisma:generate`
5. 启动：`npm run dev`

可选：如果显式设置 `SANDBOX_PROVIDER=e2b`，可把预构建模板 ID 写入 `E2B_TEMPLATE_ID`。如果显式设置 `SANDBOX_PROVIDER=vercel`，且当前 Vercel Sandbox SDK/账号支持 snapshot，可先跑 `npm run sandbox:build-opengame` 预构建 OpenGame + Chromium 环境，再把输出的 `OPENGAME_SNAPSHOT_ID` 写入环境变量。

## 关键环境变量

- `DATABASE_URL`
- `APP_BASE_URL`：本地默认 `http://localhost:3000`；本地自动 worker 会用它回调 `/api/github-worker/*`
- `BLOB_READ_WRITE_TOKEN`
- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_BASE_URL`：可选；流式头脑风暴和游戏标题、摘要、标签等元数据包装使用，缺失时复用 `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_MODEL`：可选；默认 `MiniMax-M2.7`
- `SANDBOX_PROVIDER`：可选；默认 `github`；显式设为 `e2b` 或 `vercel` 时使用对应 Sandbox 兼容路径
- `GITHUB_DISPATCH_TOKEN`：生产建议必配；Vercel 生产环境配置后会即时触发 GitHub Actions workflow。推荐使用 fine-grained token，只授权本仓库 `Actions: Read and write`。本地默认不 dispatch 远端 workflow，而是自动启动本地 GitHub 兼容 worker；如需强制本地也 dispatch 远端 workflow，可设置 `FORCE_GITHUB_DISPATCH=1`
- `GITHUB_DISPATCH_REPO`：默认 `zhang1590424-rgb/opengame-astrocade-mvp`
- `GITHUB_DISPATCH_WORKFLOW`：默认 `opengame-generate.yml`
- `GITHUB_DISPATCH_REF`：默认 `main`
- `E2B_API_KEY`：仅 `SANDBOX_PROVIDER=e2b` 时必需
- `E2B_TEMPLATE_ID`：可选；有预构建 E2B OpenGame 环境时使用
- `OPENGAME_SNAPSHOT_ID`：可选；有预构建 OpenGame Sandbox snapshot 时使用
- `OPENGAME_GIT_URL`：可选；GitHub Actions 和 Sandbox 冷启动都会按它安装 OpenGame
- `VERCEL_OIDC_TOKEN` 或 `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`；本地优先使用 `VERCEL_OIDC_TOKEN`，它会过期，出现 Sandbox 403 / OIDC refresh 错误时重新执行 `vercel env pull`
- `DISABLE_LOCAL_GITHUB_WORKER`：可选；本地设为 `1` 时不自动启动本地 worker，仅保留排队 Job 供手动排查

真实密钥只放本地 `.env` 或 Vercel Environment Variables，不提交到仓库。

## 部署

- GitHub 仓库可以保持私有；Vercel 生产部署会生成公开的 `*.vercel.app` 地址供任何人试玩。
- 生产部署前先在 Vercel Project Settings 配置上面的环境变量，或用 `vercel env add` 写入；不要把真实密钥提交到仓库。
- Vercel Web Analytics 需要在项目后台的 Analytics 页面点击 Enable；代码侧接入后，下一次生产部署开始采集真实访问数据。
- GitHub Actions worker 不保存生产密钥；它通过 Vercel 的 `/api/github-worker/*` 代理访问 MiniMax、Blob 和数据库。仓库 Variables 可选配置 `APP_BASE_URL`、`MINIMAX_TEXT_MODEL`、`OPENGAME_GIT_URL`。
- 根目录 `vercel.json` 固定 `"framework": "nextjs"`，覆盖 Vercel 项目里可能残留的 `Other` preset，避免只发布 `public/` 静态文件而让 App Router 页面 404。
- 根目录 `.vercelignore` 明确排除 `.env`、`.env.*`、`node_modules` 和 `.next`，避免本地密钥或构建产物被 CLI 当作源码上传。
- 部署命令：`vercel deploy --prod`。部署前仍需本地跑 `npx prisma generate`、`npm run lint`、`npm run build`。
- 匿名身份由服务端按需写入 `anon_id` cookie；公开试玩页不经过全局 middleware，避免 Vercel middleware 故障影响静态游戏。
- 没有数据库或生成凭据时，公开站点仍会展示并播放内置精选游戏；真实创建新游戏需要 Vercel 侧 `DATABASE_URL`、`BLOB_READ_WRITE_TOKEN`、`MINIMAX_API_KEY` 齐全。配置 `GITHUB_DISPATCH_TOKEN` 后生成会更快启动；缺失时 GitHub 定时 worker 最多延迟约 5 分钟领取任务。
- 生产环境变量变更后必须重新部署；只执行 `vercel env add` / `vercel env rm` 不会改变已经在线的 Serverless Function 环境。

## 功能闭环

- 匿名用户通过 `anon_id` httpOnly cookie 创建作品，不做登录。
- 作品广场内置 21 款“内置精选”可玩游戏：这些游戏来自 `public/builtin-games/` 的静态 HTML 和位图封面，用于新用户直接试玩；它们不写入 Prisma，不代表 OpenGame 真生成结果。
- 创建页先进入流式头脑风暴，AI 问齐核心玩法、操作方式、胜负目标、视觉/题材风格后，用户确认最终 brief 才启动 GitHub Actions 中的 OpenGame 任务。
- 本地开发时，确认 brief 后会创建同样的 GitHub-backed Job，并自动拉起本地 GitHub 兼容 worker 认领任务；线上生产则由 `GITHUB_DISPATCH_TOKEN` 触发 GitHub Actions。两者共用 `/api/github-worker/*`、MiniMax 代理、Blob 上传和自动试玩验证链路。
- 头脑风暴草稿使用 `Game.DRAFT` 和 `Message` 全程落库；草稿显示在“我的作品”，不进入公共 Gallery。
- 公共 Gallery 只展示 `READY` 真实作品和内置精选，点击进入纯游玩页 `/games/:id`；该页不展示作者修改入口、生成日志或创作对话历史。
- “我的作品”是作者工作台：顶部按“全部 / 创作中 / 已完成 / 待修复”分类，`DRAFT` / `GENERATING` 进入 `/create?game=:id`，`READY` / `FAILED` 进入 `/games/:id/edit`；一创失败也在修改工作台查看原因、调整方向并重新生成。
- OpenGame 产出的任意 HTML 会归一化为 `index.html`，但不会立刻发布；GitHub Actions worker 会用 Headless Chromium 自动试玩，验证加载、点击开始、键盘输入和画面/状态变化。
- 自动试玩失败时，系统会把验证报告交回 OpenGame 最多修复 2 轮；仍失败则标记失败，不进入可玩作品流。
- 只有通过自动试玩的产物才会上传到 Vercel Blob 并进入 `READY`；详情页通过同源 `/api/games/:id/files/...` 代理播放，避免 Blob 默认 CSP 拦截内联脚本导致游戏白屏。
- 详情页支持 Like 和 playCount；继续修改从“我的作品”进入修改工作台，修改失败时保留旧版本可玩入口。
- 继续修改会优先恢复源码包并尝试 `--continue`，不支持时使用源码上下文 + 增量 prompt 降级；一创失败的修复式重新生成不要求已有源码包，会结合原始 brief、失败原因和用户调整重新生成。
- 创建会尝试用 MiniMax 生成展示元数据（短标题、玩法摘要、类型、标签、封面提示词）；失败或没有凭据时走规则兜底，不影响真实生成任务。
- 已有作品可执行 `npm run metadata:backfill` 补齐展示元数据；脚本可重复执行，没有 MiniMax 凭据时只写规则兜底结果。

## 内置精选游戏

- 当前保留 21 款完成项；完成标准是 `public/builtin-games/<slug>/index.html` 和 `public/builtin-games/<slug>/cover.png` 同时存在，并且 `lib/builtin-games.ts` 有对应元数据。
- `public/builtin-games/shared/engine.js` 是共享 Canvas 运行时和内置游戏引擎单一事实源；每款游戏入口由 `npm run builtin:generate` 读取该引擎并根据 `lib/builtin-games.ts` 生成。
- 封面是生图技能生成的位图资产，直接保存为 `cover.png`；不要用 SVG 占位封面冒充完成。
- 如果删除半成品游戏，必须同步删除静态目录并从 `lib/builtin-games.ts` 移除，避免首页出现缺封面的卡片。

## 验证

- `npm run lint`
- `npm run build`
- `npx prisma generate`
- `npm run smoke:opengame`
- `npm run worker:github-opengame <jobId>`
- `npm run smoke:sandbox`

`smoke:opengame` 需要本机可执行 `opengame` 或设置 `OPENGAME_BIN`。本地创建/修改游戏时通常不需要手动运行 `worker:github-opengame`，开发服务器会自动启动本地 worker；该命令只作为排查工具保留，可传入真实 `Job` id，并要求 `DATABASE_URL`、`BLOB_READ_WRITE_TOKEN`、`MINIMAX_API_KEY` 可用。`smoke:sandbox` 仅用于 `e2b` / `vercel` 兼容路径；脚本会读取 `.env` 后再读取 `.env.local`。

涉及 `Job` 字段或 `JobStatus` 枚举变更后，需要对目标数据库执行 Prisma schema 同步，例如本地开发库运行 `npx prisma db push`。

### 2026-05-10 线上冒烟记录

在 `https://opengame.zz-fancy.cloud` 完成 3 个复杂真实用户流程：潜入盗宝、炼金连锁、Boss 弹幕。三个作品均从线上创建页启动，GitHub Actions 以 `workflow_dispatch` 即时领取，自动试玩通过后进入 `READY`；详情页 iframe 内均有 canvas，点击或键盘输入后浏览器 fatal error 日志为 0，并已进入公共 Gallery。
