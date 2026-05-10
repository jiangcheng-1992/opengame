# 可玩性交付门槛设计

## 1. 结论
生成链路必须从“产出 HTML”升级为“产出可玩的 HTML5 游戏”。`Game.READY` 的含义改为：游戏产物已经被浏览器加载并完成最小交互验证。

## 2. 问题本质
当前系统只检查 `index.html` 是否存在，然后上传 Blob 并发布。这个检查只能证明文件存在，不能证明玩家可以点击开始、按键移动、进入核心循环或重开。

对用户来说，最糟糕的体验不是生成失败，而是页面看起来成功、实际不能玩。因此发布门槛必须前移到 Sandbox 内部，在游戏离开生成环境前完成试玩验证和自动修复。

## 3. 推荐方案
采用“游戏契约 + 自动试玩验证 + 自动修复”的 B 方案：

1. 用户仍然自由输入 prompt。
2. 生成任务在 prompt 外层补充固定交付契约：必须有开始、核心循环、明确操作、失败/胜利或得分反馈、可重玩。
3. OpenGame 生成后不立刻发布。
4. Sandbox 启动本地静态服务器，用 Headless Chromium 打开 `index.html`。
5. 验证加载、console fatal error、点击中心/开始按钮、键盘输入、画面/DOM 是否发生变化。
6. 失败时把验证报告追加到修复 prompt，最多自动修复 2 轮。
7. 只有验证通过才写入 playable marker，前端 finalize 才允许上传并设为 `READY`。

## 4. 状态机
`JobStatus` 增加：

- `VALIDATING`：已生成 HTML，正在浏览器试玩。
- `REPAIRING`：试玩失败，正在基于验证报告自动修复。

完整流转：

`QUEUED -> RUNNING -> VALIDATING -> REPAIRING? -> VALIDATING -> FINISHING -> DONE`

失败路径：

`RUNNING/VALIDATING/REPAIRING -> FAILED`

`GameStatus` 暂不新增状态，生成、验证、修复期间仍显示 `GENERATING`；只有通过验证后进入 `READY`。

## 5. 最小验证标准
MVP 验证不试图理解每个游戏的完整玩法，只确认“可以开始并有响应”：

- HTML 能被浏览器加载。
- 运行过程中没有未处理异常、资源主入口 404、空白页面。
- 页面存在可见文本、canvas 或 DOM 游戏区域。
- 自动点击首屏中心和疑似开始按钮后，页面状态发生变化。
- 发送方向键、空格、WASD 后，canvas 截图、DOM 文本或 body 内容 hash 至少有一个变化。

这个标准不能保证“好玩”，但能拦截“点开始无效、脚本崩溃、完全静止、资源缺失”的主要坏结果。

## 6. 产品影响
- 用户创意不被模板强约束，仍然可以描述任意主题和玩法。
- 发布等待时间会增加，因为多了试玩和最多 2 轮修复。
- Gallery 质量更稳定，`READY` 作品默认可信可玩。
- 生成失败时展示真实失败原因，不用假作品冒充完成。

## 7. 验证要求
本地基础验证仍需执行：

- `npx prisma generate`
- `npm run lint`
- `npm run build`

真链路验证增加：

- 最小 prompt 生成一个单屏游戏。
- 确认日志出现 validation passed。
- 确认详情页同源 iframe 可点击开始并响应键盘。
