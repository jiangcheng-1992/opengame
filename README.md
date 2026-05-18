# OpenGame Studio

OpenGame × Astrocade 风格的内部 MVP：输入 prompt，生成可玩的 HTML5 游戏，并支持公共 Gallery、我的作品、详情播放、继续修改和 Like。

## 生产环境

- 当前公开生产入口：`https://opengame-production.up.railway.app`。生产托管以 Railway 为准，不再依赖 Vercel 部署。
- Railway Production 需要配置 `GITHUB_DISPATCH_TOKEN`，创建作品后会即时触发 GitHub Actions `opengame-generate.yml`，创建页或修改工作台的生成日志应出现 `Queued GitHub Actions workflow ... @main`。
- 如果线上生成日志退化为等待 scheduled worker，优先检查 Railway 的 `GITHUB_DISPATCH_TOKEN`、`APP_BASE_URL` 和 GitHub 仓库 Variables；修复环境变量后重新部署 Railway。
- 新生成作品文件默认写入 Railway 挂载卷/本地存储目录，并通过同源 `/api/games/:id/files/...` 播放。生产建议在 Railway 挂载持久卷并设置 `OPENGAME_STORAGE_DIR`。

## 本地启动

1. 使用 Node.js 20 或更高版本
2. 安装依赖：`npm install`
3. 配置环境变量：复制 `.env.example` 为 `.env`，填入真实值；本地默认会自动启动 GitHub 兼容 worker，不需要 `GITHUB_DISPATCH_TOKEN`
4. 生成 Prisma Client：`npm run prisma:generate`
5. 启动：`npm run dev`

可选：如果显式设置 `SANDBOX_PROVIDER=e2b`，可把预构建模板 ID 写入 `E2B_TEMPLATE_ID`。生产默认走 `SANDBOX_PROVIDER=github`，不需要 Vercel。

## 关键环境变量

- `DATABASE_URL`
- `APP_BASE_URL`：本地默认 `http://localhost:3000`；本地自动 worker 会用它回调 `/api/github-worker/*`
- `OPENGAME_STORAGE_DIR`：Railway 生产建议设置为持久卷路径，例如 `/data/opengame-storage`；缺失时写入项目目录下 `.opengame-storage`，重启可能丢失
- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_BASE_URL`：可选；流式头脑风暴和游戏标题、摘要、标签等元数据包装使用，缺失时复用 `MINIMAX_BASE_URL`
- `MINIMAX_TEXT_MODEL`：可选；默认 `MiniMax-M2.7`
- `MINIMAX_STANDARD_TEXT_MODEL` 或 `MINIMAX_TEXT_MODEL_STANDARD`：可选；创建页选择“标准”模型时优先使用，缺失时回退到 `MINIMAX_TEXT_MODEL`
- `MINIMAX_QUALITY_TEXT_MODEL` 或 `MINIMAX_TEXT_MODEL_QUALITY`：可选；创建页选择“高质”模型时优先使用，缺失时回退到 `MINIMAX_TEXT_MODEL`
- `SANDBOX_PROVIDER`：可选；默认 `github`；Railway 生产保持默认即可
- `GITHUB_DISPATCH_TOKEN`：生产建议必配；Railway 生产环境配置后会即时触发 GitHub Actions workflow。推荐使用 fine-grained token，只授权本仓库 `Actions: Read and write`。本地默认不 dispatch 远端 workflow，而是自动启动本地 GitHub 兼容 worker；如需强制本地也 dispatch 远端 workflow，可设置 `FORCE_GITHUB_DISPATCH=1`
- `GITHUB_DISPATCH_REPO`：默认 `jiangcheng-1992/opengame`
- `GITHUB_DISPATCH_WORKFLOW`：默认 `opengame-generate.yml`
- `GITHUB_DISPATCH_REF`：默认 `main`
- `E2B_API_KEY`：仅 `SANDBOX_PROVIDER=e2b` 时必需
- `E2B_TEMPLATE_ID`：可选；有预构建 E2B OpenGame 环境时使用
- `OPENGAME_GIT_URL`：可选；GitHub Actions 和 Sandbox 冷启动都会按它安装 OpenGame
- `SUPER_AI_FACTORY_TOKEN`：超级 AI 工厂触发密钥；生产必配，同名值也要写入 GitHub Secrets，供定时 workflow 调用 Railway 接口
- `SUPER_AI_FACTORY_OWNER_ID`：可选；自动生成作品归属的底层 ownerId，默认 `super-ai-factory`
- `SUPER_AI_FACTORY_BATCH_SIZE`：可选；每轮自动启动数量，默认 `1`，最大建议 `5`
- `SUPER_AI_FACTORY_MAX_ACTIVE`：可选；超级 AI 工厂同时进行中的最大 Job 数，默认 `3`
- `SUPER_AI_FACTORY_DAILY_LIMIT`：可选；超级 AI 工厂每日最多创建数量，默认 `48`
- `SUPER_AI_FACTORY_MODEL_KEY`：可选；`standard` 或 `quality`，默认 `standard`
- `DISABLE_LOCAL_GITHUB_WORKER`：可选；本地设为 `1` 时不自动启动本地 worker，仅保留排队 Job 供手动排查
- `NEXT_PUBLIC_PANGLE_APP_ID` / `NEXT_PUBLIC_PANGLE_FEED_SLOT_ID` / `NEXT_PUBLIC_PANGLE_SDK_URL`：可选；配置完整后 `/feed` 会在游戏卡片间插入穿山甲信息流广告卡片。未配置完整时不加载 SDK、不展示广告。
- `NEXT_PUBLIC_PANGLE_FEED_INTERVAL` / `NEXT_PUBLIC_PANGLE_FEED_START_INDEX`：可选；默认第 3 张游戏后开始插入，之后每 4 张游戏插入 1 张广告。

真实密钥只放本地 `.env` 或 Railway Variables，不提交到仓库。

## 部署

- GitHub 仓库可以保持私有；Railway 生产域名为 `https://opengame-production.up.railway.app`。
- Railway 构建命令使用 `npm ci`，构建脚本使用 `npm run build`，启动命令使用 `npm run start`。
- 生产部署前先在 Railway Variables 配置上面的环境变量；不要把真实密钥提交到仓库。
- GitHub Actions worker 不保存生产密钥；它通过 Railway 的 `/api/github-worker/*` 代理访问 MiniMax、Railway 存储和数据库。仓库 Variables 必须把 `APP_BASE_URL` 配置为 `https://opengame-production.up.railway.app`，可选配置 `MINIMAX_TEXT_MODEL`、`MINIMAX_STANDARD_TEXT_MODEL`、`MINIMAX_QUALITY_TEXT_MODEL`、`OPENGAME_GIT_URL`。
- 超级 AI 工厂由 `.github/workflows/super-ai-factory.yml` 每 30 分钟定时触发 Railway 的 `/api/super-ai-factory/run`，默认每轮创建 `1` 个任务，并复用 OpenGame 自动试玩、自动修复和 READY 门禁；GitHub Secrets 必须配置 `SUPER_AI_FACTORY_TOKEN`，且值与 Railway Variables 一致。
- 为避免“无限刷任务”，默认仍受 `SUPER_AI_FACTORY_MAX_ACTIVE=3` 和 `SUPER_AI_FACTORY_DAILY_LIMIT=48` 约束；如需更高频率可继续调大，但必须保持有上限。
- Railway 需要持久卷保存生成作品文件，推荐挂载到 `/data` 并设置 `OPENGAME_STORAGE_DIR=/data/opengame-storage`。
- 部署前仍需本地跑 `npx prisma generate`、`npm run lint`、`npm run build`。
- 匿名身份由服务端按需写入 `anon_id` cookie；公开试玩页不经过全局 middleware，避免中间层故障影响静态游戏。
- 没有数据库或生成凭据时，公开站点仍会展示并播放内置精选游戏；真实创建新游戏需要 Railway 侧 `DATABASE_URL`、`MINIMAX_API_KEY`、`MINIMAX_BASE_URL` 齐全。配置 `GITHUB_DISPATCH_TOKEN` 后生成会更快启动；缺失时 GitHub 定时 worker 最多延迟约 5 分钟领取任务。
- 生产环境变量变更后必须重新部署；只改 Railway Variables 不会改变已经运行中的进程。

## Android 套壳 APK

- Android WebView 套壳工程在 `android-shell/`，默认打开 `https://opengame-production.up.railway.app`。
- 本地打包命令：`npm run android:apk`。首次运行会把便携 JDK、Gradle 和 Android SDK 下载到系统临时目录的 `OpenGameAndroidBuild/`，不会修改系统环境。
- 本地生成正式签名密钥：`npm run android:keystore`。脚本会把 keystore 放到系统临时目录，并把 `OPENGAME_ANDROID_KEYSTORE_PATH`、`OPENGAME_ANDROID_KEYSTORE_PASSWORD`、`OPENGAME_ANDROID_KEY_ALIAS`、`OPENGAME_ANDROID_KEY_PASSWORD` 写入当前 Windows 用户环境变量；密码不会打印，也不要提交到 Git。
- 自定义套壳入口：`$env:OPENGAME_APP_URL="https://opengame-production.up.railway.app"; npm run android:apk`。
- 打包成功后 release APK 会复制到 `public/downloads/opengame.apk`；网页右上角“安装”按钮会优先下载这个正式签名 APK。调试包可用 `npm run android:apk:debug` 单独构建。
- GitHub Actions 也提供手动 workflow：`Android APK`，产物会作为 `opengame-apk` artifact 上传。远端正式签名需要配置仓库 Secrets：`OPENGAME_ANDROID_KEYSTORE_BASE64`、`OPENGAME_ANDROID_KEYSTORE_PASSWORD`、`OPENGAME_ANDROID_KEY_ALIAS`、`OPENGAME_ANDROID_KEY_PASSWORD`。

## 功能闭环

- 匿名用户通过 `anon_id` httpOnly cookie 创建作品，不做登录。
- 作品广场内置 21 款“内置精选”可玩游戏：这些游戏来自 `public/builtin-games/` 的静态 HTML 和位图封面，用于新用户直接试玩；它们不写入 Prisma，不代表 OpenGame 真生成结果。
- 创建页先进入流式头脑风暴，AI 问齐核心玩法、操作方式、胜负目标、视觉/题材风格后，用户确认最终 brief 才启动 GitHub Actions 中的 OpenGame 任务。
- 默认 OpenGame 生成 prompt 会要求基础美术完成度：完整背景、角色/障碍造型、HUD、动效反馈和偏精致科幻/街机的视觉质感，避免只产出白底占位原型。
- 一创确认 Brief 时可手动开启“AI 美术增强”，默认关闭；开启后会额外生成游戏内背景图和核心图集并注入 OpenGame prompt，封面图仍沿用发布阶段的现有生成链路。
- 一创确认 Brief 时还可选择“标准/高质”模型档位和玩法骨架；这两个设置会写入 `Job.modelKey` / `Job.skeletonKey`，GitHub worker、继续修改和自动重试会沿用同一生成策略。
- 本地开发时，确认 brief 后会创建同样的 GitHub-backed Job，并自动拉起本地 GitHub 兼容 worker 认领任务；线上生产则由 `GITHUB_DISPATCH_TOKEN` 触发 GitHub Actions。两者共用 `/api/github-worker/*`、MiniMax 代理、Railway 存储上传和自动试玩验证链路。
- 头脑风暴草稿使用 `Game.DRAFT` 和 `Message` 全程落库；草稿显示在“我的作品”，不进入公共 Gallery。
- 公共 Gallery 只展示 `READY` 真实作品和内置精选，点击进入纯游玩页 `/games/:id`；该页不展示作者修改入口、生成日志或创作对话历史。
- “我的作品”是作者工作台：顶部按“全部 / 创作中 / 已完成 / 待修复”分类，`DRAFT` / `GENERATING` 进入 `/create?game=:id`，`READY` / `FAILED` 进入 `/games/:id/edit`；一创失败也在修改工作台查看原因、调整方向并重新生成。
- 作者在修改工作台可把作品从公开调整为私密，或从私密重新公开；该操作只改变可见性，不触发重新生成，公开广场仍只展示 `PUBLIC + READY` 的真实作品。
- OpenGame 产出的任意 HTML 会归一化为 `index.html`，但不会立刻发布；GitHub Actions worker 会用 Headless Chromium 自动试玩，验证加载、点击开始、键盘输入和画面/状态变化。
- 自动试玩失败时，系统会把验证报告交回 OpenGame 最多修复 2 轮；仍失败则标记失败，不进入可玩作品流。
- 只有通过自动试玩的产物才会写入 Railway 存储并进入 `READY`；详情页通过同源 `/api/games/:id/files/...` 代理播放，避免外部存储 CSP 导致游戏白屏。
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

`smoke:opengame` 需要本机可执行 `opengame` 或设置 `OPENGAME_BIN`。本地创建/修改游戏时通常不需要手动运行 `worker:github-opengame`，开发服务器会自动启动本地 worker；该命令只作为排查工具保留，可传入真实 `Job` id，并要求 `DATABASE_URL`、`OPENGAME_STORAGE_DIR`、`MINIMAX_API_KEY` 可用。`smoke:sandbox` 仅用于 `e2b` / 历史兼容路径；脚本会读取 `.env` 后再读取 `.env.local`。

涉及 `Job` 字段或 `JobStatus` 枚举变更后，需要对目标数据库执行 Prisma schema 同步，例如本地开发库运行 `npx prisma db push`。

### 2026-05-10 线上冒烟记录

历史记录：曾在旧生产入口完成 3 个复杂真实用户流程：潜入盗宝、炼金连锁、Boss 弹幕。迁移到 Railway 后，生产冒烟需重新覆盖创建、GitHub Actions 回调、Railway 存储发布和详情页试玩。
