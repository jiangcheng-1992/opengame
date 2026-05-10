# OpenGame × Astrocade Clone — MVP 设计文档

> 2026-05-10 更新：这是原始方案归档。二创 / Remix 已从当前 MVP 范围移除，详见 `docs/2026-05-10-remove-remix-scope-design.md`；本文中 Remix 相关内容不再作为实现依据。

> 目标：基于 [OpenGame](https://github.com/leigest519/OpenGame) 框架，复刻 [astrocade.com/create](https://www.astrocade.com/create) 的核心创作能力，作为内部 MVP 上线。
>
> 范围（已与产品方对齐）：MVP 创作平台 — 用 prompt 生成可玩 HTML5 游戏 + 我的作品 + 公共 Gallery + Remix。**不做**创作者经济、不做按游戏定制 edit modes、不做用户分析。
>
> 部署目标：Vercel Hobby + Vercel Sandbox + MiniMax Token Plan，预计同时在线 <10 人。
>
> 本文档是交付给 codex 实现的最终设计；所有"未验证"项已显式标注，codex 实现时需先做对应冒烟测试。

---

## 0. TL;DR（给 codex 的极简版）

1. **前端**：Next.js 15 App Router + Tailwind 4 + shadcn/ui + Zustand + TanStack Query + Zod，部署在 Vercel Hobby。
2. **数据**：Vercel Postgres / Neon + Prisma；游戏产物 zip + 静态文件存 Vercel Blob。
3. **计算**：游戏生成走 **Vercel Sandbox（Persistent Sandboxes beta）**，每个生成任务一台 microVM，跑 OpenGame CLI。
4. **LLM**：统一走 **MiniMax Token Plan**，OpenAI-compatible，模型 `MiniMax-M2.7`，base `https://api.minimax.io/v1`，图像用 `image-01`。
5. **匿名身份**：cookie `anon_id` (UUID, httpOnly, 1y)，不做登录。
6. **长任务**：API 用 `detach:true` 启动 OpenGame，前端 2s 轮询 `/api/jobs/:id/progress` 绕开 Vercel Function 60s 限制。
7. **关键风险**：MiniMax 与 OpenGame tool-use 兼容性 + OpenGame `--continue` 参数 — codex 第一步必须冒烟（见 §10）。

---

## 1. 产品范围

### 1.1 必做（MVP）
- 首页：Tab 切换 [所有游戏 / 我的作品]，卡片网格展示。
- 创作页：单输入框 prompt → 一键生成 → 实时进度 → 完成后可玩。
- 详情页：iframe 嵌入运行中的游戏 + 对话历史 + 继续修改 + Remix + Like。
- Remix：基于公共游戏的代码 + 历史对话 + 新 prompt 创建新游戏。

### 1.2 不做
- 登录 / 创作者主页 / 关注 / 评论 / 创作者经济。
- 按游戏定制的 edit modes（astrocade 的多 agent 编排能力）。
- Trending / Players' Choice 等运营榜单（仅按时间倒序）。
- 用户行为分析、播放时长统计（仅记录 playCount/likeCount）。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│  Vercel Hobby                                           │
│  ┌──────────────────┐    ┌──────────────────────────┐  │
│  │ Next.js (App     │    │ Vercel Functions         │  │
│  │  Router + RSC)   │◄──►│  (API routes, ≤60s)      │  │
│  └──────────────────┘    └──────────┬───────────────┘  │
│                                     │                  │
│  ┌──────────────────┐               │                  │
│  │ Vercel Blob      │◄──────────────┤                  │
│  │  (game artifacts)│               │                  │
│  └──────────────────┘               │                  │
└─────────────────────────────────────┼──────────────────┘
                                      │
                ┌─────────────────────┼─────────────────┐
                ▼                     ▼                 ▼
        ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
        │ Postgres     │   │ Vercel Sandbox   │   │ MiniMax API  │
        │ (Prisma)     │   │ (Firecracker     │   │ (OpenAI-compat)│
        │              │   │  microVM)        │   │              │
        └──────────────┘   │  ↳ OpenGame CLI  │   └──────────────┘
                           │  ↳ Phaser build  │            ▲
                           └────────┬─────────┘            │
                                    └──────────────────────┘
                                    （sandbox 内 LLM 调用）
```

**计算分层**
- **Vercel Function**：只做接收请求 / 启动 sandbox / 轮询状态 / 写 DB 这种短逻辑，单次 ≤60s。
- **Vercel Sandbox**：跑 OpenGame Agent 长任务（最长 30min），与 Function 解耦。
- **前端**：通过 2s 轮询 `/api/jobs/:id/progress` 看进度，不依赖 SSE / WebSocket（Hobby 不支持长连）。

---

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 15 App Router + RSC + Server Actions | Vercel 一等公民；RSC 简化数据流 |
| 样式 | Tailwind CSS 4 + shadcn/ui + lucide-react | 标准组合 |
| 状态 | Zustand（客户端轻状态）+ TanStack Query v5（服务器态） | 配合 RSC 最常用 |
| 校验 | Zod | API 边界统一 |
| ORM | Prisma + Postgres | Vercel Postgres / Neon 任一 |
| 对象存储 | Vercel Blob | 游戏产物 + 封面图，CDN 自带 |
| 计算 | Vercel Sandbox（Persistent Sandboxes beta） | 同一 Vercel 账号；Active CPU 计费对长任务友好 |
| LLM | MiniMax Token Plan | 用户指定 |
| 游戏运行 | iframe 嵌入静态 HTML5 | OpenGame 默认输出 Phaser，纯静态 |

---

## 4. 数据模型（Prisma Schema）

```prisma
model AnonUser {
  id         String   @id  // 等于 cookie 里的 anon_id (UUID)
  createdAt  DateTime @default(now())
  lastSeen   DateTime @default(now())
  games      Game[]
  reactions  Reaction[]
}

model Game {
  id            String   @id @default(cuid())
  ownerId       String
  owner         AnonUser @relation(fields: [ownerId], references: [id])
  title         String   @default("Untitled")
  coverUrl      String?
  status        GameStatus @default(DRAFT)
  visibility    Visibility @default(PUBLIC)
  playUrl       String?  // Blob CDN URL，iframe 直接嵌
  sourceUrl     String?  // Blob 上的 zip，用于 Remix
  version       Int      @default(1)
  parentGameId  String?  // Remix 链
  parent        Game?    @relation("Remix", fields: [parentGameId], references: [id])
  remixes       Game[]   @relation("Remix")
  playCount     Int      @default(0)
  likeCount     Int      @default(0)
  messages      Message[]
  jobs          Job[]
  reactions     Reaction[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([visibility, createdAt])
  @@index([ownerId, createdAt])
}

enum GameStatus { DRAFT GENERATING READY FAILED }
enum Visibility { PUBLIC PRIVATE }

model Message {
  id        String   @id @default(cuid())
  gameId    String
  game      Game     @relation(fields: [gameId], references: [id])
  role      Role
  content   String   @db.Text
  jobId     String?
  createdAt DateTime @default(now())

  @@index([gameId, createdAt])
}

enum Role { USER AGENT SYSTEM }

model Job {
  id          String   @id @default(cuid())
  gameId      String
  game        Game     @relation(fields: [gameId], references: [id])
  status      JobStatus @default(QUEUED)
  sandboxId   String?  // Persistent Sandbox name
  prompt      String   @db.Text
  errorMsg    String?  @db.Text
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime @default(now())

  @@index([gameId, createdAt])
}

enum JobStatus { QUEUED RUNNING FINISHING DONE FAILED }

model Reaction {
  id      String @id @default(cuid())
  gameId  String
  game    Game   @relation(fields: [gameId], references: [id])
  anonId  String
  anon    AnonUser @relation(fields: [anonId], references: [id])
  type    ReactionType
  createdAt DateTime @default(now())

  @@unique([gameId, anonId, type])
}

enum ReactionType { LIKE }
```

**消息历史保留策略**：DB 全量保留；发送给 LLM 时由 app 层截取最后 20 轮。

---

## 5. API 设计

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/me` | 返回 `anon_id`（middleware 已写 cookie） |
| GET | `/api/games?tab=all\|mine&cursor=` | 列表，分页 cursor-based |
| GET | `/api/games/:id` | 详情 + messages |
| POST | `/api/games` | 创建游戏 + 启动 Job |
| POST | `/api/games/:id/messages` | 继续修改（追加新 prompt + 启动新 Job） |
| POST | `/api/games/:id/like` | 切换 LIKE |
| POST | `/api/games/:id/play` | 自增 playCount |
| POST | `/api/games/:id/remix` | 基于源游戏 + 新 prompt 创建新游戏 |
| GET | `/api/jobs/:id/progress` | 轮询：返回 status / 进度日志末尾 N 行 |
| POST | `/api/jobs/:id/finalize` | 任务完成时把产物上传 Blob、更新 Game |

### 5.1 Cookie 中间件（middleware.ts 草案）

```ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export function middleware(req: Request) {
  const res = NextResponse.next();
  const cookies = (req as any).cookies;
  if (!cookies.get('anon_id')) {
    res.cookies.set('anon_id', randomUUID(), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  return res;
}
```

### 5.2 限流（防匿名滥用）

中间件按 `anon_id` 限流：每 cookie 每天最多 **10 次** 创建任务；同 IP 兜底每天 30 次。超限返回 429。

---

## 6. Vercel Sandbox 集成

### 6.1 一次性 Snapshot 构建（推荐：Persistent Sandboxes beta）

**推荐方案**：用 `Sandbox.create({ name: 'opengame-base' })` 创建一台带名字的 sandbox，装好依赖后停掉，Vercel 会自动 snapshot；后续 `Sandbox.get({ name: 'opengame-base' })` 能恢复出同样的环境。

```ts
// scripts/build-snapshot.ts —— 上线前手工跑一次
import { Sandbox } from '@vercel/sandbox';

const sandbox = await Sandbox.create({
  name: 'opengame-base',
  runtime: 'node24',
  timeout: 30 * 60_000,
});

// AL2023 默认带 dnf + sudo
await sandbox.runCommand({ cmd: 'sudo', args: ['dnf', 'install', '-y', 'chromium', 'git'] });
await sandbox.runCommand({ cmd: 'git', args: ['clone', 'https://github.com/leigest519/OpenGame.git', '/opt/opengame'] });
await sandbox.runCommand({ cmd: 'bash', args: ['-lc', 'cd /opt/opengame && npm install && npm run build'] });

// 不依赖 npm link：保留绝对路径调用，避免 snapshot 后链接失效
await sandbox.runCommand({ cmd: 'bash', args: ['-lc', 'ls /opt/opengame/bin/opengame'] });

await sandbox.stop(); // 自动 snapshot
```

> **回退方案**：如果 Persistent Sandboxes beta 不稳，改用手工 snapshot API：`const snapshotId = await sandbox.snapshot()`，把 `snapshotId` 存到环境变量 `OPENGAME_SNAPSHOT_ID`，后续 `Sandbox.create({ source: { snapshot: process.env.OPENGAME_SNAPSHOT_ID! } })` 启动。

### 6.2 启动生成任务（POST /api/games）

```ts
import { Sandbox } from '@vercel/sandbox';

export async function startGameJob({ jobId, prompt }: { jobId: string; prompt: string }) {
  const sandbox = await Sandbox.create({
    name: `job-${jobId}`,        // 每个 job 一个独立 sandbox
    source: { name: 'opengame-base' }, // 从 base snapshot 启动
    runtime: 'node24',
    timeout: 30 * 60_000,
  });

  // 写入 LLM 配置
  await sandbox.writeFiles([{
    path: '/root/.qwen/settings.json',
    content: JSON.stringify({
      model: 'MiniMax-M2.7',
      apiBase: 'https://api.minimax.io/v1',
      apiKey: process.env.MINIMAX_API_KEY,
    }),
  }]);

  // 启动 OpenGame，detach=true → 立即返回，不阻塞 Function
  await sandbox.runCommand({
    cmd: '/opt/opengame/bin/opengame',
    args: ['-p', prompt, '--yolo', '--out', '/workspace/game'],
    cwd: '/workspace',
    env: {
      OPENAI_API_KEY: process.env.MINIMAX_API_KEY!,
      OPENAI_BASE_URL: 'https://api.minimax.io/v1',
      OPENAI_MODEL: 'MiniMax-M2.7',
    },
    detach: true,
    stdout: { redirect: '/workspace/progress.log' },
    stderr: { redirect: '/workspace/error.log' },
  });

  // 把 sandbox name 存进 Job
  await prisma.job.update({
    where: { id: jobId },
    data: { sandboxId: `job-${jobId}`, status: 'RUNNING', startedAt: new Date() },
  });
}
```

### 6.3 进度轮询（GET /api/jobs/:id/progress）

```ts
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: params.id } });
  if (['DONE','FAILED'].includes(job.status)) return Response.json({ status: job.status, errorMsg: job.errorMsg });

  const sandbox = await Sandbox.get({ name: job.sandboxId! });
  const tail = await sandbox.readFile('/workspace/progress.log').catch(() => '');
  const errTail = await sandbox.readFile('/workspace/error.log').catch(() => '');
  const exists = await sandbox.fileExists('/workspace/game/index.html').catch(() => false);

  if (exists) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'FINISHING' } });
    return Response.json({ status: 'finishing', log: tailLastLines(tail, 30) });
  }
  if (errTail.includes('Error:')) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', errorMsg: errTail.slice(0,2000), finishedAt: new Date() } });
    return Response.json({ status: 'failed', errorMsg: errTail.slice(0,2000) });
  }
  return Response.json({ status: 'running', log: tailLastLines(tail, 30) });
}
```

### 6.4 收尾（POST /api/jobs/:id/finalize）

```ts
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: params.id } });
  const sandbox = await Sandbox.get({ name: job.sandboxId! });

  // 流式上传 index.html / 资源 / 源码 zip 到 Vercel Blob
  // 注意：避免一次性 zip 大文件造成 Function 60s 超时 —— 直接逐文件流式上传
  const playUrl = await uploadDirToBlob(sandbox, '/workspace/game', `games/${job.gameId}/play/`);
  const sourceUrl = await uploadFileToBlob(sandbox, '/workspace/game.zip', `games/${job.gameId}/source.zip`);

  await prisma.game.update({
    where: { id: job.gameId },
    data: { status: 'READY', playUrl, sourceUrl },
  });
  await prisma.job.update({
    where: { id: job.id },
    data: { status: 'DONE', finishedAt: new Date() },
  });

  await sandbox.stop(); // 释放 microVM
  return Response.json({ ok: true });
}
```

> 如果 finalize 504，前端检测到后自动重试 1 次（见 §8.2）。

---

## 7. 前端关键流程

### 7.1 创作页

```
[输入 prompt] → 提交
  → POST /api/games  返回 { gameId, jobId }
  → 路由 push /games/[gameId]?job=[jobId]
  → 详情页挂载 useJobProgress(jobId)
```

### 7.2 useJobProgress hook（最终版）

```ts
function useJobProgress(jobId: string) {
  const [state, setState] = useState({ status: 'queued', log: '' });
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`/api/jobs/${jobId}/progress`).then(r => r.json());
          setState(r);
          if (r.status === 'finishing') {
            // 自动收尾，504 时重试 1 次
            const ok = await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST' });
            if (!ok.ok) await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST' });
          }
          if (['done','failed'].includes(r.status)) break;
        } catch (e) { /* 网络抖动忽略 */ }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [jobId]);
  return state;
}
```

### 7.3 游戏运行 iframe

```tsx
<iframe
  src={game.playUrl}
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="autoplay; fullscreen; gamepad"
  className="w-full aspect-video rounded-xl"
/>
```

> Phaser / WebGL / AudioContext 在上述属性下可用；如果 codex 测试发现某些 API 被拒，按需增加 `allow-modals` 等。

---

## 8. MiniMax 集成

### 8.1 凭据 / 端点

| 项 | 值 |
|---|---|
| Base URL | `https://api.minimax.io/v1` |
| 鉴权 | `Authorization: Bearer ${MINIMAX_API_KEY}` |
| Chat 主选 | `MiniMax-M2.7`（204800 ctx） |
| Chat 备选 | `MiniMax-M2.7-highspeed` |
| 图像模型 | `image-01` |

### 8.2 OpenGame 入口（Sandbox 内）

环境变量 + `/root/.qwen/settings.json` 双保险写入（见 §6.2）。

### 8.3 封面图（Server Action 直调，不进 Sandbox）

游戏 `status=READY` 后由后台异步任务调 `image-01`：

```ts
const r = await fetch('https://api.minimax.io/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
  body: JSON.stringify({ model: 'image-01', prompt: `Pixel art cover for: ${game.title}`, n: 1, size: '512x512' }),
});
const { data } = await r.json();
// 把 data[0].url 转存到 Vercel Blob，回填 Game.coverUrl
```

失败不阻塞游戏可玩。

### 8.4 配额护栏

App 层维护 `daily_image_quota` 一行计数，超过当日上限直接返回占位图；超 5h Chat 请求窗口让 Job 失败并提示用户等待重置（不自动重试）。

---

## 9. Remix 流程

```
用户在公共游戏详情页点 [Remix]
  → 弹出 modal："基于这个游戏，描述你想改什么"
  → POST /api/games/:id/remix { prompt }
  → Server:
      1. 校验源 Game.visibility=PUBLIC
      2. 复制源 sourceUrl 的 zip 到新 sandbox 的 /workspace
      3. 把源 Game 最后 20 条 messages 插入新 Game 的 messages 表
      4. 启动 OpenGame，传 --continue 让其在已有代码上修改（参见 §10 风险）
      5. 进入与首次创建一致的 Job 轮询流程
  → 跳到新 /games/[newId]
```

**回退方案**（如 OpenGame 不支持 `--continue`）：把源代码塞进首条 prompt：

```
prompt = `Existing game code:\n\`\`\`\n${sourceCode}\n\`\`\`\n\nNow apply this change: ${userPrompt}`
```

代价：首轮上下文大；优点：功能可用。codex 实现时先按推荐方案做，跑不通再切回退。

---

## 10. 失败处理 & 风险册

### 10.1 失败矩阵

| 失败位置 | 检测 | 用户看到 | 系统动作 |
|---|---|---|---|
| Sandbox 创建失败 | `Sandbox.create()` throw | "服务繁忙" | Job=FAILED，不重试 |
| OpenGame 启动失败 | `error.log` 头部含 `Error:` | "生成器启动失败" | Job=FAILED，sandbox 留 30 分钟备查 |
| MiniMax 限流/401 | log 含 `429`/`401` | "AI 服务暂不可用" | Job=FAILED；401 触发告警 |
| 长跑超 30min | 轮询累计时长 | "生成超时" | `sandbox.stop()`，Job=FAILED |
| Finalize 504 | Function 超时 | 自动重试 1 次 | 仍失败 → Job=FAILED |
| 用户关页 | 无 | 重开页继续轮询 | Sandbox 内任务不受影响 |

### 10.2 风险清单（已验证 / 未验证）

| # | 风险 | 状态 | 处理 |
|---|---|---|---|
| R1 | Hobby 5h Active CPU/月够否 | ✅ 已验证：Active CPU 不计 I/O 等待，OpenGame 等 LLM 时不计费；按 30s/任务估算可支持 600 任务/月 | 容量预算够用 |
| R2 | Sandbox ≤45min 是否够 | ✅ 已验证：官方 Hobby 上限 45min；我们设 30min 硬超时 | 见 §10.1 |
| R3 | AL2023 装 Chromium | ✅ 已验证：`sudo dnf install chromium` 可用 | 见 §6.1 |
| R4 | snapshot 管理方式 | ✅ 已验证：Persistent Sandboxes beta（`Sandbox.create({name})` + `Sandbox.get({name})`，停机自动 snapshot） | 推荐 beta；不稳就回退手工 snapshot API |
| R5 | MiniMax 模型名 / base URL | ✅ 已验证 | 见 §8.1 |
| R6 | **MiniMax 对 OpenAI tools 的兼容性** | ⚠️ **无法预先验证**：MiniMax 文档未给等价矩阵；OpenGame 的 Game/Debug Skill 强依赖 tool-use | **codex 第一步必须冒烟**：用最小 prompt 跑一次，观察 tool 调用是否生效。失败回退：`MiniMax-M2.7-highspeed` 或 OpenGame 非 tool-use 模式 |
| R7 | **OpenGame `--continue`（Remix 必需）** | ⚠️ **无法预先验证**：仓库 README 未明确列出 | codex 实现 Remix 前先 `opengame --help`；不支持就用 §9 回退方案 |
| R8 | iframe sandbox 属性兼容性 | ⚠️ 部分验证 | §7.3 给的字符串覆盖 Phaser 主流；遇到拒绝时按需加 `allow-modals` |
| R9 | Finalize 60s 超时 | ⚠️ 视产物大小 | 流式上传，避免先 zip；前端 504 自动重试 1 次 |
| R10 | 匿名用户配额滥用 | ⚠️ 已知 | 中间件按 `anon_id` 每天 10 次 + IP 兜底 30 次 |
| R11 | npm link 在 snapshot 是否存活 | ⚠️ 不确定 | 不依赖 link，固定走 `/opt/opengame/bin/opengame` 绝对路径 |
| R12 | Vercel Blob 月 20GB 传输 | ✅ 已验证 | 单游戏 ~2MB → 1 万次播放/月就接近上限，README 中提示升级 Pro |

### 10.3 codex 第一周必须做的冒烟测试

1. **R6 冒烟**：在 Sandbox 内手跑 `opengame -p "a 1-screen pong" --yolo --out /workspace/g`，观察 LLM 工具调用是否生效。
2. **R7 冒烟**：`opengame --help`，确认 `--continue` 或等价参数；不存在则切 §9 回退方案。
3. **R11 冒烟**：snapshot 后用 `Sandbox.get({name:'opengame-base'})` 恢复，确认 `/opt/opengame/bin/opengame` 仍可执行。

任意一项不通 → 在实现 Remix / 多轮对话之前必须先解决。

---

## 11. 环境变量清单

```
# Postgres
DATABASE_URL=...

# Vercel Blob
BLOB_READ_WRITE_TOKEN=...

# MiniMax
MINIMAX_API_KEY=...

# Sandbox snapshot（Persistent Sandboxes beta 模式下不需要；手工 snapshot 模式下需要）
OPENGAME_SNAPSHOT_ID=...
```

---

## 12. 容量预算（<10 人内部使用）

| 项 | 估算 | Hobby 限额 | 余量 |
|---|---|---|---|
| Active CPU | 30s/任务 × 200 任务/月 = 100min | 5h (300min) | 充裕 |
| Sandbox 创建数 | 200 + Remix 100 = 300/月 | 5000/月 | 充裕 |
| 内存 GB-hr | 30min × 1GB × 200 = 100 GB-hr | 420 GB-hr | 充裕 |
| Sandbox 存储 | base snapshot 5GB + 临时 2GB | 15GB | 充裕 |
| Blob 传输 | 单游戏 ~2MB × 1000 次播放 = 2GB | 20GB/月 | 充裕 |

**结论**：Hobby 套餐对 <10 人 MVP 完全够用；Blob 传输是第一个会触顶的资源（用户量增长时优先升级）。

---

## 13. 实现里程碑（建议顺序）

1. **M0 — 基础设施**：Vercel 项目 + Postgres + Blob + Sandbox base snapshot 构建脚本。
2. **M1 — 冒烟**：完成 §10.3 三项冒烟，决策 R6/R7/R11 走主路径还是回退。
3. **M2 — 单游戏闭环**：cookie 中间件 + POST /api/games + Sandbox 启动 + 轮询 + finalize + iframe 播放。
4. **M3 — 列表 / 详情 / Like / playCount**：所有游戏 + 我的作品两 tab。
5. **M4 — 多轮对话**：在已有游戏上继续修改（与 M2 共用 Job 轮询）。
6. **M5 — Remix**：基于 M4 + R7 决策结果实现。
7. **M6 — 封面图 + 限流 + 风险监控**：image-01 调用 + 中间件限流 + 任务失败告警。

每个里程碑结束跑一次容量自检（Vercel Dashboard 看用量），避免 Hobby 触顶。

---

## 14. 关于本设计的边界说明

- 本设计基于截至 2026-05-08 的 Vercel Sandbox / Hobby / MiniMax Token Plan 公开文档。Persistent Sandboxes 处于 beta，API 形状可能调整 —— 实现前 codex 应再读一次最新 changelog。
- OpenGame 仓库（leigest519/OpenGame）的具体 CLI 参数与 Skill 行为以仓库 README 与 `--help` 为准；本文档对 `--continue`、`--yolo`、`-p`、`--out` 的使用基于 qwen-code/Gemini CLI 的常见约定，已在 §10 标记为待 codex 冒烟确认。
- 所有 ✅ / ⚠️ 标注遵循"未验证不写实"原则；codex 接手后如发现与文档不符，应以实测为准，并把发现回填到本 §10.2 表格。
