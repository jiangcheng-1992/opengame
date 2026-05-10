# Astrocade 核心 UI/UX 演进设计

> 2026-05-10 更新：二创 / Remix 已从当前 MVP 范围移除，详见 `docs/2026-05-10-remove-remix-scope-design.md`。本文中 Remix 相关分组和排序只作为早期探索记录，不再作为实现依据。

## 1. 观察结论

Astrocade 的核心不是“AI 游戏生成器说明页”，而是一个可玩的内容平台：用户先进 Feed，看到 Players' Choice、Trending、Recommended 等分组，卡片用播放量和作品封面建立兴趣，再进入 Create / Remix / Profile 等创作者闭环。

本项目仍是内部 MVP，因此只吸收对主链路有价值的部分：

- 首页从介绍型 Hero 改为 Play Feed + 快捷 prompt 输入。
- Gallery 分成 Players' Choice、Trending、Remix Ready 三类，先用现有播放、喜欢、Remix、时间信号排序。
- Create 支持从首页带 prompt 进入，降低“空白输入框”的启动成本。
- 详情页维持播放、Like、继续修改、Remix，不引入评论、通知、创作者经济等超出 MVP 的能力。

## 2. 不做的能力

- 不做登录和真实 Profile。
- 不做 Analytics、Comments、Notifications 页面。
- 不做假数据填充；没有数据库或作品时展示真实不可用/空状态。
- 不把 Blob URL 直接塞进 iframe，仍遵守同源代理播放约束。

## 3. UI 结构

首页：

1. 顶部导航：Gallery、My Arcade、Create。
2. 首屏：产品主张 + 可直接输入的创作面板。
3. 信号条：当前作品数、累计播放、Remix 次数。
4. Feed 分组：
   - Players' Choice：按 `playCount * 3 + likeCount * 8 + remixCount * 13` 排序。
   - Trending：按 `createdAt` 最近排序。
   - Remix Ready：只展示 `READY` 状态作品。

创建页：

1. 主输入区：明确要求用户描述玩法、控制、视觉、胜负条件。
2. 示例 prompt：一键替换输入。
3. 可见性切换：公开 / 私密。
4. Prompt guide：只保留三条可执行建议，避免教程化。

移动端：

- 顶部保留品牌，隐藏桌面导航。
- 底部 Tab Bar 提供 Gallery、Create、My Arcade 三个顶级入口。

## 4. 用户影响

- 新用户先看到“有东西可玩”，不必先理解技术栈。
- 首页输入可以直接带到 Create，减少一次导航和重复输入。
- 榜单分组让用户知道应该先试玩什么，也为 Remix 找参照。
- My Arcade 作为匿名身份下的个人作品入口，符合 MVP 不登录约束。

## 5. 验证

本次改动后需要跑：

- `npx prisma generate`
- `npm run lint`
- `npm run build`

涉及 UI，还需要启动本地服务检查首页、创建页、详情页在桌面和窄屏下没有明显错位。
