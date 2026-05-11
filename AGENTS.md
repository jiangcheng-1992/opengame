# 游戏创作器项目规则

## 项目定位
- 本项目是 OpenGame × Astrocade 风格的内部 MVP：用 prompt 生成可玩的 HTML5 游戏，并支持作品列表、详情播放、继续修改、Like。
- 目标优先级：真实生成链路可跑 > 产品闭环清楚 > 视觉精致。不要先做大而全的运营能力。

## 执行原则
- 规则先行：新增目录、脚本、接口前先确认是否符合本文件；需要改规则时先改本文件。
- 密钥不进代码：`MINIMAX_API_KEY`、`BLOB_READ_WRITE_TOKEN`、`DATABASE_URL`、`GITHUB_DISPATCH_TOKEN`、`E2B_API_KEY`、`VERCEL_OIDC_TOKEN`、`VERCEL_TOKEN` 只通过环境变量提供。
- 本地 env 不上传：`.env`、`.env.local`、`.env.*` 既不能进 Git，也不能被 Vercel CLI 当作源码上传；根目录 `.vercelignore` 必须持续排除这些文件，线上密钥只配到 Vercel Environment Variables。
- 不用 mock 冒充完成：生成链路默认走 GitHub Actions + MiniMax + OpenGame 真接口；`SANDBOX_PROVIDER=e2b` 或 `SANDBOX_PROVIDER=vercel` 时才走对应 Sandbox 兼容路径。没有凭据时允许实现代码和本地构建，但必须明确标注未跑真实冒烟；页面可以显示真实依赖不可用状态，但不能用假作品冒充数据。
- 改完要验证：至少跑 `npm run lint`、`npm run build`、`npx prisma generate`。涉及 UI 时启动本地服务并打开页面验。

## 工程约定
- Next.js App Router 代码放在 `app/`。
- 复用 UI 组件放在 `components/`。
- 服务端能力和第三方集成放在 `lib/`，不要把外部 SDK 细节散落到 route handler。
- GitHub Actions 生成 worker 放在 `.github/workflows/opengame-generate.yml` 和 `scripts/run-github-opengame-job.ts`；Vercel 负责创建 Job、可选 dispatch workflow，并通过 `/api/github-worker/*` 代理 MiniMax、Blob 上传和 Prisma 回写，避免把生产密钥复制到 GitHub Secrets。
- 本地开发默认也走 GitHub-backed Job，但不要求 GitHub Actions 访问 localhost：确认生成后由 Next.js 开发服务器自动启动本地 GitHub 兼容 worker，回调 `APP_BASE_URL` 的 `/api/github-worker/*` 完成 MiniMax 代理、Blob 上传和 Prisma 回写。只有 Vercel / GitHub Actions / `FORCE_GITHUB_DISPATCH=1` 才 dispatch 远端 workflow。
- 生产环境 `https://opengame.zz-fancy.cloud` 依赖 Vercel Production 的 `GITHUB_DISPATCH_TOKEN` 即时触发 GitHub Actions；2026-05-10 已配置并验证。排查线上生成延迟时，应在创建页或修改工作台的生成日志里优先确认是否出现 `Queued GitHub Actions workflow ... @main`；若变成定时 worker fallback，检查 token 是否缺失或过期，并在修复 env 后重新部署。
- 内置可玩游戏放在 `public/builtin-games/`：每款游戏一个 `<slug>/index.html` 和一张生成位图封面 `cover.png`，共享运行时代码放在 `public/builtin-games/shared/`；`scripts/generate-builtin-games.ts` 读取共享 `engine.js` 生成入口页，不要把整段引擎重新内嵌回脚本。
- 内置游戏清单放在 `lib/builtin-games.ts`，只有同时具备 `index.html` 和 `cover.png` 的完成项才能进入清单；半成品目录必须删除或保持不被引用。
- Prisma schema 放在 `prisma/schema.prisma`，数据库变更先改 schema，再写业务。
- 匿名身份在 `lib/auth.ts` 按需读取/写入 `anon_id` cookie；不要为此恢复全局 `middleware.ts`，避免 Vercel middleware 拦截静态试玩页。
- Vercel 部署框架必须由根目录 `vercel.json` 固定为 `nextjs`；不要删除该文件，否则项目设置里的 `Other` preset 会把站点当静态 `public` 输出处理，导致 App Router 动态路由 404。
- 设计和决策文档放在 `docs/`，命名格式为 `YYYY-MM-DD-<topic>-design.md`。
- 脚本放在 `scripts/`，脚本必须可重复执行，失败时输出明确原因。

## 产品约束
- 匿名身份使用 `anon_id` httpOnly cookie，一年有效期；不做登录。
- MVP 只做 Gallery、我的作品、创建、详情播放、继续修改、Like、playCount。
- 暂不做二创 / Remix：不要展示 Remix 入口，不提供 `/api/games/:id/remix`，不要用 remixCount 做排序或展示。
- 创建页必须先进入流式头脑风暴：问齐核心玩法、操作方式、胜负目标、视觉/题材风格后，用户确认 brief 才能启动 OpenGame 生成。
- `DRAFT` 表示头脑风暴草稿；草稿只出现在“我的作品”，不进入公共 Gallery。直接创建作品的兼容接口也只能创建草稿，不能绕过头脑风暴启动生成。
- 公共 Gallery 和 `/games/:id` 是纯游玩态，只展示 `READY` 作品与内置精选，不展示作者修改入口、生成日志或创作对话历史；“我的作品 / 创作台”才进入作者工作态。
- “我的作品”点击规则：`DRAFT` / 无可玩版本的 `GENERATING` 进入 `/create?game=:id`；`READY` / `FAILED` 进入 `/games/:id/edit`。已可玩作品提交继续修改时，`Game.status` 仍保持 `READY`，只用最新 `Job.status` 表达“新版本生成中”，点击仍进入 `/games/:id/edit`。
- `READY` 不能只代表产出 HTML；必须代表游戏已经通过 Sandbox 内浏览器自动试玩验证。至少确认页面可加载、无 fatal JS error、开始/点击/键盘输入能让游戏状态发生变化。
- 自动试玩失败时允许最多 2 轮修复；仍失败则标记失败并展示真实原因，不进入 Gallery 的可玩作品流。
- 继续修改优先恢复 `sourceUrl` 源码包并尝试 `--continue`，不支持时走“源码上下文 + 新 prompt”降级方案；修改生成期间旧版本必须继续可玩，失败时不能把已有可玩作品降级为不可玩。
- 详情页播放必须走同源 `/api/games/:id/files/...` 代理；不要直接把 Blob HTML URL 塞进 iframe，因为 Blob 默认 CSP 会拦截内联脚本，导致很多单文件游戏白屏。
- 封面图生成失败不能阻塞游戏可玩。
- 内置精选游戏是 onboarding 内容，不代表 OpenGame 真生成结果；页面必须明确标记“内置精选”，不能用它们冒充真实生成作品。
- GitHub Actions 默认按 `OPENGAME_GIT_URL` 冷启动安装 OpenGame；`E2B_TEMPLATE_ID` / `OPENGAME_SNAPSHOT_ID` 是 Sandbox 兼容路径的加速项，不是硬依赖。`OPENGAME_SNAPSHOT_ID` 仅用于 Vercel Sandbox 兼容路径。

## 验证约定
- 本地基础验证：`npm run lint`、`npm run build`、`npx prisma generate`。
- 真链路冒烟：最小 prompt 生成一个单屏游戏，确认同源代理 playUrl 可 iframe 播放。
- 生产变更冒烟：至少创建 2-3 个真实作品，覆盖键盘动作、鼠标点击、复杂状态/胜负；确认 GitHub Actions run 为 `workflow_dispatch` 且成功、作品进入 `READY`、详情页 iframe/canvas 可交互、公共 Gallery 可见。
- 本地真实链路冒烟：启动 `npm run dev` 后从创建页确认 brief；日志应显示本地 GitHub 兼容 worker 自动认领 Job，并进入 `RUNNING` / `VALIDATING` / `READY` 或真实失败原因。不需要手动运行 worker，除非设置了 `DISABLE_LOCAL_GITHUB_WORKER=1` 做排查。
- Sandbox 使用后必须停止释放，除非为了排查失败临时保留，并在日志/文档中说明。
