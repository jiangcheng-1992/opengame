# 游戏创作器项目规则

## 事实源与目标
- 本文件是最高优先级执行规则；`README.md` 是启动、环境变量、部署和排查手册；`docs/` 是历史设计记录，旧文档与本文件/README 冲突时只作背景。
- 本项目是 OpenGame × Astrocade 风格内部 MVP：用 prompt/brief 生成可玩的 HTML5 游戏，支持 Gallery、我的作品、详情播放、继续修改、Like、playCount、基础账号注册/登录与作品资产归属。
- 优先级：真实生成链路可跑 > 产品闭环清楚 > 视觉精致；账号只做创建门槛和资产找回，不做评论、创作者经济等非 MVP 能力。
- 新目录、脚本、接口、状态或外部服务接入前先确认规则；需要调整规则时先改本文件，再改代码。

## 安全与环境
- 密钥只通过环境变量提供，绝不进代码、日志、文档或 Git；完整变量清单以 `README.md` 的“关键环境变量”为准。
- `.env`、`.env.local`、`.env.*` 不能进 Git，也不能被 Railway/GitHub 当源码上传。
- 默认生成后端是 `SANDBOX_PROVIDER=github`；生产只使用 Railway + GitHub Actions，`e2b` 仅作为历史兼容排查路径。
- 没有真实凭据时可以完成代码和本地构建，但必须标注未跑真实冒烟；页面可展示依赖不可用状态，不能用假作品/假结果冒充完成。

## 工程地图
- Next.js App Router 在 `app/`；复用 UI 在 `components/`；服务端能力和第三方集成在 `lib/`，不要把 SDK 细节散落到 route handler。
- Prisma schema 在 `prisma/schema.prisma`；数据库变更先改 schema，再改业务；涉及 `Job` 字段或枚举时同步目标数据库。
- 生成 worker 在 `.github/workflows/opengame-generate.yml` 和 `scripts/run-github-opengame-job.ts`；设计文档放 `docs/YYYY-MM-DD-<topic>-design.md`；脚本放 `scripts/` 且必须可重复执行。
- Railway 负责生产托管、创建 Job、可选 dispatch workflow，并通过 `/api/github-worker/*` 代理 MiniMax、Railway 存储上传和 Prisma 回写，生产密钥不放 GitHub Secrets。
- 本地确认生成后由 Next.js 自动启动本地 GitHub 兼容 worker，回调 `APP_BASE_URL`；只有 Railway / GitHub Actions / `FORCE_GITHUB_DISPATCH=1` 才 dispatch 远端 workflow。
- 生产域名是 `https://opengame-production.up.railway.app`；日志出现 `Queued GitHub Actions workflow ... @main` 表示即时触发正常，退回 scheduled worker 时先查 Railway 的 `GITHUB_DISPATCH_TOKEN` 并重新部署。
- 超级 AI 工厂通过 `/api/super-ai-factory/run` 和 `.github/workflows/super-ai-factory.yml` 批量创建自动生成作品；必须用 `SUPER_AI_FACTORY_TOKEN` 保护，并受 `SUPER_AI_FACTORY_MAX_ACTIVE` / `SUPER_AI_FACTORY_DAILY_LIMIT` 控制，不能实现无上限刷任务。
- 内置游戏在 `public/builtin-games/<slug>/`，必须同时有 `index.html` 和位图 `cover.png` 才能进 `lib/builtin-games.ts`；共享引擎只维护 `public/builtin-games/shared/engine.js`。
- 不要恢复全局 `middleware.ts` 处理匿名身份，避免影响静态试玩页。

## 产品状态机
- 账号体系使用邮箱/密码注册登录，`auth_session` httpOnly cookie 维持登录态；`anon_id` 继续作为底层 ownerId 兼容旧数据。
- 创建游戏必须先登录；登录/注册后把当前匿名作品合并到账号的固定 `primaryAnonId`，保证“我的作品”和继续修改能跨设备找回。
- 创建页必须先流式头脑风暴，问齐核心玩法、操作方式、胜负目标、视觉/题材风格，用户确认 brief 后才启动 OpenGame。
- 默认生成 prompt 也必须包含基础美术质量要求：即使未开启“AI 美术增强”，也要要求完整背景、角色/障碍造型、HUD、动效反馈和偏精致科幻/街机的视觉完成度；用户明确指定其他风格时保留用户风格但不能退回原型占位图。
- 一创“AI 美术增强”是可选增强项，默认关闭；开启时只新增游戏内背景图和核心图集生图，封面图继续走发布阶段现有链路，素材失败必须降级为同风格程序化美术而不是阻塞可玩生成。
- 一创确认 brief 时可选择生成模型档位和玩法骨架；`Job.modelKey` / `Job.skeletonKey` 是后续 worker、继续修改和重试沿用同一生成策略的事实源。
- `DRAFT` 是头脑风暴草稿，只在“我的作品”出现；兼容创建接口也只能创建草稿，不能绕过头脑风暴直接生成。
- 公共 Gallery 和 `/games/:id` 是纯游玩态，只展示 `PUBLIC READY` 作品与内置精选，不展示作者修改入口、生成日志或创作对话历史。
- `/feed` 可在游戏卡片间插入信息流广告，但广告 SDK、AppID、广告位 ID 和频率只能通过环境变量配置；未配置完整时不加载广告，不得用假广告冒充真实填充。
- “我的作品”点击：`DRAFT` 或无可玩版本的 `GENERATING` 进 `/create?game=:id`；`READY` / `FAILED` 进 `/games/:id/edit`。
- 作者可在 `/games/:id/edit` 调整作品公开/私密；这只更新 `Game.visibility`，不触发重新生成，公开广场仍只展示 `PUBLIC READY`。
- 已可玩作品继续修改时 `Game.status` 保持 `READY`，只用最新 `Job.status` 表达新版本进度；旧版本必须继续可玩，失败不能降级。
- `READY` 必须表示已通过自动试玩验证：页面可加载、无 fatal JS error、开始/点击/鼠标拖拽/键盘/移动端触摸手势能让状态变化；失败最多自动修复 2 轮。
- 每个新生成游戏必须同时设计桌面与手机操作：鼠标点击/拖拽、键盘方向/WASD/空格、手机 tap/swipe/drag 至少有等价可用路径；不允许只支持单一输入方式导致另一端无法游玩。
- 每个新生成游戏必须有多关卡、多波次、递进难度或连续目标，默认至少 3 个阶段；不能只玩一关/一波/一个谜题就结束。
- 详情页 iframe 必须走同源 `/api/games/:id/files/...` 代理，不能直接塞外部 HTML URL，避免 CSP 导致白屏。
- 封面图和元数据是增强项，失败不能阻塞可玩版本发布。
- 内置精选只做 onboarding，必须标记“内置精选”，不能冒充 OpenGame 真生成作品。
- 暂停公开 Remix/二创网络：不展示 remixCount、不中断纯游玩态、不恢复 `/api/games/:id/remix`；但允许从公共 `READY` 作品以及“内置精选”创建“到我的可编辑副本”，副本默认归当前匿名用户且不直接公开，用于后续对话调整；内置精选副本必须保留“模板/内置来源”语义，不能冒充 OpenGame 真生成作品。

## 生成链路
- 主链路：brief → `Job(QUEUED)` → GitHub Actions / 本地兼容 worker → OpenGame → Headless Chromium 自动试玩 → Railway 存储发布 → `Game.READY`。
- GitHub Actions 默认按 `OPENGAME_GIT_URL` 冷启动安装 OpenGame；`E2B_TEMPLATE_ID` 仅是兼容路径加速项。
- 继续修改优先使用 `sourceUrl` 源码包和 `--continue`；失败修复或不支持继续时，用历史对话、失败原因、源码上下文和新 prompt 降级重建。

## 验证约定
- 基础改动：跑 `npm run lint`、`npm run build`、`npx prisma generate`。
- UI 改动：启动本地服务并打开相关页面验桌面/移动布局、交互、iframe 是否正常。
- 生成链路改动：本地从创建页确认 brief，日志应进入 `RUNNING` / `VALIDATING` / `READY` 或展示真实失败原因。
- 生产变更：创建 2-3 个真实作品，覆盖键盘、鼠标、复杂状态/胜负；确认 workflow_dispatch 成功、作品 READY、详情页可交互、Gallery 可见。
- Sandbox/E2B/Vercel 兼容路径用后必须停止释放；仅排查历史兼容路径时临时保留，并在日志/文档说明。
