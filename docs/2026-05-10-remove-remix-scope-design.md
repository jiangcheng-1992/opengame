# 暂停二创能力设计

## 1. 决策

2026-05-10 起，MVP 暂停二创 / Remix 能力，产品聚焦一创和游玩两个模块。

原因是当前阶段最需要验证的是：

- 用户能否通过头脑风暴创建一个清楚的游戏 brief。
- OpenGame 真实生成链路能否稳定产出可玩的 HTML5 游戏。
- 详情页能否提供沉浸、可靠的试玩体验。

二创会引入额外的源代码恢复、源作品上下文、父子作品关系和生成失败解释成本，暂时不进入主链路。

## 2. 范围

- 删除详情页和卡片里的 Remix 入口、按钮、提示和 remixCount 展示。
- 删除 `/api/games/:id/remix` 路由，不再对外提供二创接口。
- 保留数据库中已有 `parentGameId` / `remixes` 字段，先不做迁移，避免为范围收缩引入数据风险。
- 内置游戏只作为 onboarding 试玩内容，不再作为 Remix 源。

## 3. 保留能力

- Gallery / 我的作品。
- 创建页流式头脑风暴和一创生成。
- 详情页同源 iframe 播放、Like、playCount。
- 作者自己的作品继续修改。

## 4. 验证

- `npx prisma generate`
- `npm run lint`
- `npm run build`
- 确认构建路由清单中不再出现 `/api/games/[id]/remix`。
