# Playful Gradient 视觉改造设计

## 目标
- 只调整视觉系统，不改变生成、编辑、状态机、路由、接口或数据结构。
- 将当前暖色编辑风格推进到 Playful / Gradient Playground：浅底、柔和渐变、粉色主操作、清晰工具区。
- 大氛围图使用 PNG，小型品牌与标题装饰使用 SVG，保证清晰和轻量。

## 范围
- 全局颜色、圆角、阴影、按钮、卡片、导航、作品卡、创建/编辑工作台外观。
- 我的作品 Hero 图替换为更贴近 Playful 风格的装饰 PNG。
- 品牌标识、标题点缀、创建页顶部增加 SVG 装饰感。

## 非目标
- 不新增页面、按钮、功能入口。
- 不改任何 API 请求、状态判断、数据库 schema、生成 worker 或 OpenGame 链路。
- 不用假数据或假生成结果制造完成感。

## 资产策略
- `public/playful-creator-hero.png`：宽幅创作桌面插图，用于已有 Hero 视觉位。
- `public/playful-brand-mark.svg`：品牌标识替换现有纯色方块。
- `public/playful-section-spark.svg`：标题与顶部区域的小型装饰。

## 验证
- 基础验证：`npm run lint`、`npm run build`、`npx prisma generate`。
- UI 验证：本地打开首页、我的作品、创建页、编辑页，检查桌面和移动端无文字重叠、无横向滚动、按钮与状态文案不溢出。
