# 流式头脑风暴创建流程设计

## 背景

创建器从“输入 prompt 后直接生成”调整为“先对话澄清，再确认生成”。核心目标是减少一句话 prompt 带来的失败率和返工：用户先把玩法、操作、胜负目标、视觉/题材风格说清楚，再启动耗时且消耗额度的 OpenGame 真实生成链路。

## 方案

- 流式对话使用 Vercel AI SDK 6：`useChat` 管理前端消息状态，`streamText` 负责服务端流式输出，MiniMax 通过 `@ai-sdk/openai-compatible` 接入。
- `/create` 是第一版唯一入口；首页仍可携带初始 prompt 跳转到 `/create`。
- 草稿全程落库：`Game.DRAFT` 表示头脑风暴草稿，`Message` 保存用户与 AI 对话，不新增会话表。
- 用户确认最终 brief 后调用 `/api/games/:id/generate`，创建 `Job` 并复用现有 `startOpenGameJob`、进度轮询、自动试玩验证和发布流程。
- 公共 Gallery 不展示 `DRAFT`；“我的作品”展示 `DRAFT`，点击回到 `/create?game=<id>` 继续聊。

## 接口

- `POST /api/games/drafts`：创建 `DRAFT` 草稿。
- `POST /api/games/:id/brainstorm`：接收 `{ message }`，返回 AI SDK UI message stream，并在流结束后保存 AI 消息。
- `POST /api/games/:id/generate`：接收 `{ brief, visibility }`，只允许草稿 owner 启动生成。
- `POST /api/games`：保留为兼容入口，但只创建草稿，不再绕过头脑风暴直接生成。

## 输出约定

AI 每轮回复包含面向用户的中文说明，并在末尾附带结构化 JSON：

```text
<opengame_brief_json>
{"isReady":false,"brief":"","missingSlots":["胜负目标"],"suggestions":["60 秒内收集 20 个宝石"]}
</opengame_brief_json>
```

前端隐藏这段 JSON，只用它控制建议按钮、缺口提示和“生成可玩版本”按钮。

如果模型回复里缺失或写坏了 `suggestions`，前端只从当前 agent 可见文本中的编号选项兜底提取可点回复；提取不到就隐藏按钮。开场默认创意只用于新会话欢迎消息，不能挂到后续 agent 追问下面，避免用户点击到与当前问题不一致的旧选项。

## 验证

- `npx prisma generate`
- `npm run lint`
- `npm run build`
- 有真实凭据时，用最小游戏 brief 做一次完整生成冒烟，确认详情页 iframe 仍走同源代理播放。
