# OpenGame × Astrocade Clone — 方案入口

原 Opus 方案已归档到：

- `docs/2026-05-08-opengame-astrocade-clone-design-original.md`

当前可执行修正版在：

- `docs/2026-05-08-opengame-astrocade-mvp-design.md`

本项目实现以修正版为准。关键修正包括：

- MiniMax 当前本地密钥使用 `https://api.minimaxi.com/v1`，不是 `https://api.minimax.io/v1`。
- Vercel Sandbox 集成不使用未经确认的 `name/source.name/fileExists/redirect` SDK 写法。
- OpenGame CLI 实测支持 `--continue`，但没有 `--out`；生成目录通过 `cwd` 控制。
- OpenGame 可能生成 `pong.html` 等任意 HTML 文件名，平台会归一化为 `index.html` 后发布。
- Function 超时按当前 Vercel Node.js Hobby 300s 口径处理，但生成长任务仍放 Sandbox。
