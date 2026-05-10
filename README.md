# OpenGame Studio

OpenGame × Astrocade 风格的内部 MVP：输入 prompt，生成可玩的 HTML5 游戏，并支持公共 Gallery、我的作品、详情播放、继续修改和 Like。

## 本地启动

1. 安装依赖：`npm install`
2. 配置环境变量：复制 `.env.example` 为 `.env`，填入真实值；本地 Vercel Sandbox 认证推荐先执行 `vercel link`，再执行 `vercel env pull` 生成/刷新 `.env.local`
3. 生成 Prisma Client：`npm run prisma:generate`
4. 启动：`npm run dev`

可选：如果当前 Vercel Sandbox SDK/账号支持 snapshot，先跑 `npm run sandbox:build-opengame` 预构建 OpenGame + Chromium 环境，再把输出的 `OPENGAME_SNAPSHOT_ID` 写入环境变量。

## 关键环境变量

- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_BASE_URL`：可选；流式头脑风暴和游戏标题、摘要、标签等元数据包装使用，缺失时复用 `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_MODEL`：可选；默认 `MiniMax-M2.7`
- `OPENGAME_SNAPSHOT_ID`：可选；有预构建 OpenGame Sandbox snapshot 时使用
- `OPENGAME_GIT_URL`：可选；没有 snapshot 时，Sandbox 会在任务内冷启动安装 OpenGame
- `VERCEL_OIDC_TOKEN` 或 `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`；本地优先使用 `VERCEL_OIDC_TOKEN`，它会过期，出现 Sandbox 403 / OIDC refresh 错误时重新执行 `vercel env pull`

真实密钥只放本地 `.env` 或 Vercel Environment Variables，不提交到仓库。

## 功能闭环

- 匿名用户通过 `anon_id` httpOnly cookie 创建作品，不做登录。
- 作品广场内置 21 款“内置精选”可玩游戏：这些游戏来自 `public/builtin-games/` 的静态 HTML 和位图封面，用于新用户直接试玩；它们不写入 Prisma，不代表 OpenGame 真生成结果。
- 创建页先进入流式头脑风暴，AI 问齐核心玩法、操作方式、胜负目标、视觉/题材风格后，用户确认最终 brief 才启动 Vercel Sandbox 中的 OpenGame 任务。
- 头脑风暴草稿使用 `Game.DRAFT` 和 `Message` 全程落库；草稿显示在“我的作品”，不进入公共 Gallery。
- OpenGame 产出的任意 HTML 会归一化为 `index.html`，但不会立刻发布；Sandbox 会用 Headless Chromium 自动试玩，验证加载、点击开始、键盘输入和画面/状态变化。
- 自动试玩失败时，系统会把验证报告交回 OpenGame 最多修复 2 轮；仍失败则标记失败，不进入可玩作品流。
- 只有通过自动试玩的产物才会上传到 Vercel Blob 并进入 `READY`；详情页通过同源 `/api/games/:id/files/...` 代理播放，避免 Blob 默认 CSP 拦截内联脚本导致游戏白屏。
- 详情页支持 Like、playCount 和继续修改；继续修改失败时保留旧版本可玩入口。
- 继续修改会优先恢复源码包并尝试 `--continue`，不支持时使用源码上下文 + 增量 prompt 降级；生成产物覆盖上传，确保同一作品继续修改后仍指向最新可玩版本。
- 创建会尝试用 MiniMax 生成展示元数据（短标题、玩法摘要、类型、标签、封面提示词）；失败或没有凭据时走规则兜底，不影响真实生成任务。
- 已有作品可执行 `npm run metadata:backfill` 补齐展示元数据；脚本可重复执行，没有 MiniMax 凭据时只写规则兜底结果。

## 内置精选游戏

- 当前保留 21 款完成项；完成标准是 `public/builtin-games/<slug>/index.html` 和 `public/builtin-games/<slug>/cover.png` 同时存在，并且 `lib/builtin-games.ts` 有对应元数据。
- `public/builtin-games/shared/engine.js` 是共享 Canvas 运行时；每款游戏入口由 `npm run builtin:generate` 根据 `lib/builtin-games.ts` 生成。
- 封面是生图技能生成的位图资产，直接保存为 `cover.png`；不要用 SVG 占位封面冒充完成。
- 如果删除半成品游戏，必须同步删除静态目录并从 `lib/builtin-games.ts` 移除，避免首页出现缺封面的卡片。

## 验证

- `npm run lint`
- `npm run build`
- `npx prisma generate`
- `npm run smoke:opengame`
- `npm run smoke:sandbox`

`smoke:opengame` 需要本机可执行 `opengame` 或设置 `OPENGAME_BIN`。`smoke:sandbox` 需要可用的 Vercel Sandbox 凭据；脚本会读取 `.env` 后再读取 `.env.local`，方便使用 `vercel env pull` 刷新的 OIDC token。没有 `OPENGAME_SNAPSHOT_ID` 时，应用运行时会走冷启动安装 OpenGame 的路径。

涉及 `JobStatus` 枚举变更后，需要对目标数据库执行 Prisma schema 同步，例如本地开发库运行 `npx prisma db push`。
