# 内置游戏 FC 化重写设计

## 背景

当前 21 款内置游戏的封面和主题已经成立，但游戏内体验更像通用 Canvas demo：圆形、圆角矩形、渐变背景、简单碰撞和随机刷怪较多。用户感知问题不是“不能玩”，而是“题材像游戏，实际不像小时候红白机上的小卡带”。

本设计目标是把内置游戏从“现代 AI 小样”升级为“原创 FC / 红白机气质小游戏”：低分辨率、有限调色板、瓦片地图、硬边像素 sprite、直接的操作反馈和清晰的关卡/波次规则。

## 目标

- 21 款内置游戏在试玩页内明显呈现 8-bit / FC 风格，而不是现代矢量风格。
- 每款游戏的玩法承诺落地到可感知规则，例如地铁跳跃有跳/滑，迷宫记忆真的走迷宫，迷你塔防有塔、敌人、波次和金币。
- 保持内置游戏的 onboarding 定位：打开即可玩，不依赖数据库、Blob、Sandbox、MiniMax 或 OpenGame 凭据。
- 改动限定在内置游戏生成和运行时，不影响作品广场、详情页、生成链路、数据库 schema、真实作品接口。

## 非目标

- 不做 NES 硬件级模拟器，不追求 PPU、APU、mapper 等真实硬件还原。
- 不复制任天堂或其他经典游戏的角色、地图、音乐、关卡或商标元素。
- 不替换现有封面图；本次只升级游戏内玩法和美术。
- 不新增登录、运营、排行榜、成就、关卡编辑器等产品能力。
- 不改真实 OpenGame 生成链路。

## 风格定义

本项目中的“FC 化”指浏览器 Canvas 中的原创 8-bit 风格近似，标准如下：

| 维度 | 设计标准 |
|---|---|
| 分辨率 | 使用 320x200 或接近比例的虚拟逻辑坐标，再按整数倍率绘制到 960x600 Canvas |
| 像素 | 关闭平滑插值，所有角色、地形、子弹、道具使用硬边像素块或 tile 绘制 |
| 调色板 | 每款控制在少量高对比颜色内，避免现代渐变和大面积霓虹光效 |
| 背景 | 使用 tile 地形、星点、砖块、网格、山体、管线等可重复像素元素 |
| UI | 使用像素风 HUD，显示 SCORE、LIFE、TIME、WAVE、COIN 等必要信息 |
| 反馈 | 命中、跳跃、受伤、得分、过关有短促动画、闪烁、震屏和 8-bit 音效 |
| 操作 | 手感直接，键盘方向明确；保留鼠标类游戏的点击/瞄准直觉 |

## 方案

采用 **A+：共享引擎 FC 化重写**。

| 方案 | 内容 | 取舍 |
|---|---|---|
| A+ 共享引擎 FC 化重写 | 以 `public/builtin-games/shared/engine.js` 作为引擎单一源，`scripts/generate-builtin-games.ts` 只读取它并生成 21 个入口页 | 影响面集中，21 款同时升级，避免脚本模板和产物双份维护 |
| 单独手改每个 `index.html` | 给每款加定制配置 | 不采用；会被生成脚本覆盖，维护成本高 |
| 每款独立引擎 | 21 套独立游戏代码 | 不采用；质量上限高但 MVP 风险和维护成本过大 |

## 文件范围

允许修改：

| 文件 | 用途 |
|---|---|
| `scripts/generate-builtin-games.ts` | 读取共享引擎并生成 21 个入口页 |
| `public/builtin-games/shared/engine.js` | 内置游戏引擎的单一事实源 |
| `docs/2026-05-10-builtin-famicom-retro-upgrade-design.md` | 本设计文档 |

原则上不修改：

| 路径 | 原因 |
|---|---|
| `app/` | 不改页面与 API 行为 |
| `components/` | 不改产品 UI 组件 |
| `lib/` | 不改内置清单、真实作品服务、第三方集成 |
| `prisma/` | 内置游戏不写数据库 |
| `public/builtin-games/*/cover.png` | 封面图当前可接受，本次只改游戏内体验 |
| `public/builtin-games/<slug>/index.html` | 不手改单个入口；如生成后无实质差异，不应产生 diff |

如果实现中发现必须新增结构化配置字段，才考虑小范围修改 `lib/builtin-games.ts` 和 `pageHtml()` 的配置输出；这需要再次确认。

## 技术设计

### 渲染层

- 保持 `<canvas id="game" width="960" height="600">`，避免影响页面嵌入和 iframe 播放。
- 引擎内部定义虚拟画布，例如 `VW = 320`、`VH = 200`、`SCALE = 3`。
- 所有绘制通过像素 helper 完成，例如 `pxRect()`、`pxSprite()`、`pxText()`、`tileMap()`。
- 设置 `ctx.imageSmoothingEnabled = false`。
- 背景改为 tile / pattern，而不是当前的大面积渐变。
- HUD 改为像素面板，保留中文标题可以出现在 overlay，游戏中 HUD 尽量用图标和短英文标签，减少字体不稳定。

### 音效层

- 使用 WebAudio 合成短促 8-bit 音效，不引入音频素材文件。
- 默认在首次点击/按键开始后初始化音频，避免浏览器自动播放限制。
- 音效类型：start、jump、shoot、hit、pickup、hurt、win、lose。
- 提供静默降级：浏览器不允许 AudioContext 时不阻塞游戏。

### 状态层

- 保留现有 `resetBase()`、`initXxx()`、`updateXxx()`、`drawXxx()` 分发结构，减少重构风险。
- 增加通用状态：`particles`、`shake`、`flash`、`invulnerable`、`combo`、`wave`、`difficulty`。
- 新增对象必须在对应 `initXxx()` 初始化，避免重开局状态残留。
- 所有子弹、粒子、敌人、平台必须有清理逻辑，避免长时间运行掉帧。

## 21 款改造设计

| 游戏 | 类型 | FC 化玩法方向 |
|---|---|---|
| 星港闪避 | `dodge` | 小飞船穿过星港航道，收集芯片，敌机和碎片带有预警线；近身闪避加分 |
| 深空清道夫 | `dodge` | 太空清道夫拖回废件到回收区，流星横穿，收集和交付有不同反馈 |
| 霓虹砖块 | `breakout` | 经典打砖块卡带感，多血砖、裂纹、连击、球速上限、像素爆裂 |
| 像素守门员 | `goalie` | 点球大战，守门员三帧扑救，射手预告方向，连续扑救倍率 |
| 熔岩跳台 | `platform` | 火山平台跳跃，平台下沉、岩浆气泡、冷却晶石延长挑战 |
| 云端接力 | `platform` | 云朵平台、风环、弹跳点，跳跃容错但节奏更明确 |
| 月面跑者 | `runner` | 低重力长跳，氧气道具，陨坑和通讯塔障碍 |
| 地铁跳跃 | `runner` | 跳过护栏、下键滑过信号门，连续躲避加速 |
| 齿轮冲刺 | `runner` | 齿轮和蒸汽喷口按节奏出现，障碍组合保证可通过 |
| 风暴滑板 | `lane` | 三车道换道缓动，水坑/广告牌/闪电预警，拾取 boost |
| 小行星炮塔 | `turret` | 中心炮台、准星、炮口火光、小行星血量和碎裂 |
| 泡泡防线 | `defense` | 泡泡炮点击发射，同色连击爆开，裂缝血条 |
| 城墙守卫 | `defense` | 城墙防守，敌人血量、弩箭/油锅效果用点击节奏表现 |
| 蜂群突围 | `swarm` | 四边刷怪、自动射击最近威胁、蜂群分离、爆炸和受伤无敌 |
| 弹幕圆环 | `swarm` | 圆形竞技场生存，旋转弹幕、安全缺口、护盾碎片 |
| 迷你塔防 | `tower` | 路径、金币、三类塔、可见炮弹、波次和击杀返金币 |
| 镜面光束 | `beam` | 多关激光房，镜子、暗砖、核心、开关，光束逐格移动 |
| 仓库推箱 | `sokoban` | 标准 Sokoban 分层地图，目标不被覆盖，撤销、步数评分 |
| 颜色连线 | `connect` | 5x5 电路板铺线，同色端点连接，线不交叉并覆盖格子 |
| 数字开锁 | `lock` | 保险箱数字轮、尝试历史、剩余次数、齿轮开锁动画 |
| 迷宫记忆 | `memory` | 真正迷宫：先亮安全路径，灯灭后按方向走，踩错扣命 |

## 实施记录

2026-05-10 已按 **A+：共享引擎 FC 化重写** 实施，实际写入范围保持在内置游戏运行时、入口页生成脚本和本设计文档内。

| 内容 | 结果 |
|---|---|---|
| 共享引擎 | `public/builtin-games/shared/engine.js` 成为内置游戏引擎单一事实源 |
| 生成脚本 | `scripts/generate-builtin-games.ts` 不再内嵌大字符串，只读取共享引擎并生成 21 个入口页 |
| 入口页 | 21 个 `public/builtin-games/<slug>/index.html` 继续引用 `../shared/engine.js`，并开启 `image-rendering: pixelated` |
| 产品边界 | 未改 `app/`、`components/`、`lib/`、`prisma/` 和真实 OpenGame 生成链路 |

## 验收标准

### 视觉验收

- 任意打开一款内置游戏，第一眼能看出低分辨率像素风，而不是现代 Canvas 几何图。
- 玩家、敌人、道具、地形至少有基础 sprite 特征，不再主要依赖圆形和圆角矩形。
- 背景和 HUD 有卡带感，不出现大面积现代渐变、玻璃拟态、霓虹浮层。

### 玩法验收

- 每款游戏 30 秒内能感知核心规则。
- 21 款至少在玩法上分成明确不同体验，而不是同类换皮。
- 胜负条件可达，失败原因可理解。
- 键盘类、鼠标类、点击类操作都与 `lib/builtin-games.ts` 中的 controls 一致。

### 工程验收

- `npm run builtin:generate` 后，21 个 `index.html` 保持统一入口结构，并继续引用 `../shared/engine.js`。
- 理想 diff 只包含 `scripts/generate-builtin-games.ts`、`public/builtin-games/shared/engine.js`、21 个入口页的像素渲染 CSS 和本设计文档。
- 不引入外部素材、外部 CDN、密钥、网络请求。
- 不改变真实生成链路和数据库行为。

## 验证计划

基础验证：

```bash
npm run builtin:generate
npm run lint
npm run build
npx prisma generate
```

本地 UI 验证：

```bash
npm run dev
```

抽测路径：

| 类型 | 路径 |
|---|---|
| 键盘动作 | `/builtin-games/subway-hop/index.html` |
| 鼠标射击 | `/builtin-games/asteroid-turret/index.html` |
| 解谜点击 | `/builtin-games/mirror-beam/index.html` |
| 推箱键盘 | `/builtin-games/warehouse-push/index.html` |
| 塔防点击 | `/builtin-games/mini-tower/index.html` |
| 详情页 iframe | `/games/builtin-starport-dash` |

浏览器验证项：

- 页面可加载，无 fatal JS error。
- 点击或空格可开始。
- 键盘/鼠标输入能改变游戏状态。
- Canvas 非空，且开始前后像素明显变化。
- 重开局不会残留上局对象。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 共享引擎改动影响全部游戏 | 分类型实现，先保留原有分发结构，逐类替换 |
| 共享引擎继续膨胀 | 后续如继续大改，可把 `engine.js` 拆成源码模块并由脚本构建到 `public/builtin-games/shared/engine.js` |
| 玩法增强后难度失衡 | 每款保留 3 条命或明确容错，时间/波次从保守值开始 |
| WebAudio 被浏览器限制 | 仅在用户交互后启用，失败静默降级 |
| 像素字体中文显示不稳定 | 游戏内 HUD 少用中文；标题和说明仍可用系统字体 |
| 粒子/敌人太多导致掉帧 | 对数组长度设上限，屏外对象及时清理 |

## 当前结论

2026-05-10 已完成上线验证。生产域名 `https://opengame-astrocade-mvp.vercel.app/`、内置游戏详情页 `/games/builtin-neon-bricks` 和静态入口 `/builtin-games/neon-bricks/index.html` 均返回 200；浏览器抽测确认详情页 iframe 内有 1 个游戏 canvas，可点击并接收方向键输入。

部署修复要点：

- 公开试玩链路不再依赖全局 `middleware.ts`；匿名身份在 `lib/auth.ts` 中按需读取/写入 `anon_id` cookie。
- Vercel framework 由根目录 `vercel.json` 固定为 `nextjs`，避免项目设置中的 `Other` preset 只发布 `public/` 静态目录，导致 App Router 首页和详情页 404。
