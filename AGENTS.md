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
- GitHub Actions 生成 worker 放在 `.github/workflows/opengame-generate.yml` 和 `scripts/run-github-opengame-job.ts`；Vercel 只负责创建 Job 并 dispatch workflow，不在 route handler 里内嵌生成脚本。
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
- `READY` 不能只代表产出 HTML；必须代表游戏已经通过 Sandbox 内浏览器自动试玩验证。至少确认页面可加载、无 fatal JS error、开始/点击/键盘输入能让游戏状态发生变化。
- 自动试玩失败时允许最多 2 轮修复；仍失败则标记失败并展示真实原因，不进入 Gallery 的可玩作品流。
- 继续修改优先恢复 `sourceUrl` 源码包并尝试 `--continue`，不支持时走“源码上下文 + 新 prompt”降级方案。
- 详情页播放必须走同源 `/api/games/:id/files/...` 代理；不要直接把 Blob HTML URL 塞进 iframe，因为 Blob 默认 CSP 会拦截内联脚本，导致很多单文件游戏白屏。
- 封面图生成失败不能阻塞游戏可玩。
- 内置精选游戏是 onboarding 内容，不代表 OpenGame 真生成结果；页面必须明确标记“内置精选”，不能用它们冒充真实生成作品。
- GitHub Actions 默认按 `OPENGAME_GIT_URL` 冷启动安装 OpenGame；`E2B_TEMPLATE_ID` / `OPENGAME_SNAPSHOT_ID` 是 Sandbox 兼容路径的加速项，不是硬依赖。`OPENGAME_SNAPSHOT_ID` 仅用于 Vercel Sandbox 兼容路径。

## 验证约定
- 本地基础验证：`npm run lint`、`npm run build`、`npx prisma generate`。
- 真链路冒烟：最小 prompt 生成一个单屏游戏，确认同源代理 playUrl 可 iframe 播放。
- Sandbox 使用后必须停止释放，除非为了排查失败临时保留，并在日志/文档中说明。
