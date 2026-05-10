# E2B Sandbox 生成运行时迁移方案

## 背景

Vercel Sandbox Hobby 额度触顶后会返回 HTTP 402，导致线上不能继续创建 OpenGame 生成环境。项目规模预计 10-20 人试用，目标不是改产品形态，而是在低成本前提下恢复“prompt -> OpenGame -> 自动试玩验证 -> Blob 发布”的真实闭环。

## 决策

- 主站继续部署在 Vercel Hobby，数据库和 Blob 链路不变。
- 生成运行时从 Vercel Sandbox 迁到 E2B Sandbox，环境变量使用 `E2B_API_KEY`。
- 保留 Vercel Sandbox 代码路径作为显式可选后端：`SANDBOX_PROVIDER=vercel` 时才使用；默认 `SANDBOX_PROVIDER=e2b`。
- 不采用 MiniMax 直出 HTML 降级作为主方案，避免降低 OpenGame 产物质量和自动试玩保障。

## 架构

`lib/sandbox.ts` 继续作为统一入口，向业务层暴露 `startOpenGameJob`、`getJobProgress`、`hasPlayableBuild`、`stopSandbox` 等能力。内部通过 provider adapter 兼容：

- E2B：`Sandbox.create()`、`sandbox.commands.run()`、`sandbox.files.read/write()`、`Sandbox.connect()`、`sandbox.kill()`。
- Vercel：保留原 `@vercel/sandbox` 调用，用于以后额度恢复或对比验证。

`Job.sandboxId` 存储带 provider 前缀的运行时标识，例如 `e2b:<sandboxId>` 或 `vercel:<sandboxId>`，避免不同平台 ID 混淆。

## 执行细节

- 工作目录从 `/vercel/sandbox` 改为更通用的 `/tmp/opengame-workspace`，两种 provider 都可写。
- OpenGame 安装、生成、可玩性验证仍在 sandbox 内执行。
- 系统依赖安装脚本同时支持 `apt-get`、`dnf`、`yum`，适配 E2B 和 Vercel 镜像差异。
- E2B 后台命令使用 `commands.run(command, { background: true })`，API 轮询通过文件读取获取日志和状态。
- 发布仍走 Vercel Blob，同源代理播放不变。

## 用户影响

- 线上生成恢复可用，不再消耗 Vercel Sandbox 额度。
- 游戏质量和验证标准保持原路径：OpenGame 生成，Headless Chromium 自动试玩验证后才进入 `READY`。
- 首次冷启动可能仍较慢，因为需要在 E2B 内安装 OpenGame 和 Playwright Chromium；后续可再做 E2B template 预构建优化。

## 验证

- 本地基础验证：`npm run lint`、`npm run build`、`npx prisma generate`。
- 运行时烟测：配置 `E2B_API_KEY` 后执行 `npm run smoke:sandbox`。
- 真实链路烟测：线上配置 `SANDBOX_PROVIDER=e2b`、`E2B_API_KEY`、`MINIMAX_API_KEY`、`BLOB_READ_WRITE_TOKEN`、`DATABASE_URL` 后创建一个最小游戏，确认详情页 iframe 可播放。
