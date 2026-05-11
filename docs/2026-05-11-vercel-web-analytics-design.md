# Vercel Web Analytics 接入设计

## 背景

项目需要监控生产页面访问情况，包括访客量、页面浏览、访问来源、国家/地区、设备和浏览器等基础数据。当前项目已部署在 Vercel，但代码侧尚未接入 Web Analytics 采集组件。

## 方案

- 使用 Vercel 官方 `@vercel/analytics` 包，在 App Router 根布局挂载 `Analytics` 组件。
- 采集范围覆盖所有 Next.js 页面，包括首页、创建页、详情页、修改工作台和 API 外的普通页面访问。
- 不新增自研数据库表，不采集用户输入内容、prompt、游戏源码或身份标识。
- 访问数据在 Vercel Project 的 Analytics 页面查看；生产部署后生效。

## 取舍

- 先接 Web Analytics，而不是自研埋点：最直接满足“页面访问情况”监控，接入成本低，也避免在 MVP 阶段维护额外数据链路。
- 暂不接业务自定义事件：游戏创建、Like、播放等已有业务数据分别由现有接口和数据库承载；等需要漏斗分析时再补 `track` 事件。
- 暂不接 Speed Insights：性能监控和访问监控是两个问题；本次优先解决访问监控。

## 验证

- `npm run lint`
- `npm run build`
- `npx prisma generate`

生产侧还需要在 Vercel Project 的 Analytics 页面点击 Enable，并完成一次生产部署。
