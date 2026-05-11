# 继续修改生成状态设计

## 背景
- 已完成游戏提交修改后，旧实现会把同一个 `Game.status` 改成 `GENERATING`。
- 这会让 `/games/:id/edit` 服务端守卫拒绝访问，刷新后出现“找不到这个游戏”；“我的作品”也会把该作品按一创生成中送回 `/create?game=:id`。

## 决策
- 已可玩的作品提交继续修改时，`Game.status` 保持 `READY`。
- 新版本生成进度只由最新 `Job.status` 表达，修改工作台负责展示这个 Job。
- 公共游玩页和同源文件代理继续播放旧版，直到新 Job 发布成功并覆盖 `playUrl`。
- 只有无可玩版本的一创或失败修复，才把 `Game.status` 置为 `GENERATING`。

## 路由规则
- `DRAFT` / 无可玩版本的 `GENERATING`：进入 `/create?game=:id`。
- `READY` / `FAILED`：进入 `/games/:id/edit`。
- `READY` 且最新 Job 仍在 `QUEUED` / `RUNNING` / `VALIDATING` / `REPAIRING` / `FINISHING`：仍进入 `/games/:id/edit`，左侧保留旧版试玩，右侧显示新版本进度。

## 失败与发布
- 修改生成失败时，旧版 `playUrl`、`version` 和公共试玩能力保持不变。
- 修改生成成功发布后覆盖当前可玩文件，`version` 增加 1。
- 同一作品存在活跃 Job 时，前端禁用重复提交，后端返回冲突错误。

## 验证
- `npx prisma generate`
- `npm run lint`
- `npm run build`
- 本地对 `READY` 作品提交修改，刷新 `/games/:id/edit` 不应 404。
- 修改生成中从“我的作品”点击作品，应进入修改工作台而不是创建对话页。
