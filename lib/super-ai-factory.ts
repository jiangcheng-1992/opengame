import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { fallbackGameMetadata, generateGameMetadata } from "@/lib/game-metadata";
import { normalizeGameplaySkeletonKey } from "@/lib/gameplay-skeleton";
import { progressForJobStatus } from "@/lib/job-progress";
import { normalizeGenerationModelKey } from "@/lib/minimax-config";
import { createMiniMaxTextModel } from "@/lib/minimax-text";
import { startOpenGameJob } from "@/lib/sandbox";
import type { ContentTypeValue } from "@/lib/content-type";

const FACTORY_TAG = "超级AI工厂";
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "VALIDATING", "REPAIRING", "FINISHING"] as const;

type FactoryIdea = {
  title: string;
  contentType: ContentTypeValue;
  brief: string;
  skeletonKey?: string;
};

type FactoryRunOptions = {
  batchSize?: number;
  dryRun?: boolean;
};

export function getSuperAiFactoryLocalRuntimeStatus() {
  const missing: string[] = [];
  if (!process.env.MINIMAX_API_KEY?.trim()) missing.push("MINIMAX_API_KEY");
  if (!process.env.APP_BASE_URL?.trim()) missing.push("APP_BASE_URL");
  const sandboxProvider = process.env.SANDBOX_PROVIDER?.trim() || "github";
  const autoStartsLocalWorker = sandboxProvider === "github" && process.platform !== "win32" && process.env.DISABLE_LOCAL_GITHUB_WORKER !== "1";
  return {
    ok: missing.length === 0,
    missing,
    appBaseUrl: process.env.APP_BASE_URL?.trim() || null,
    sandboxProvider,
    platform: process.platform,
    autoStartsLocalWorker,
  };
}

function isLocalAppBaseUrl(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
}

async function validateFactoryRuntime() {
  const local = getSuperAiFactoryLocalRuntimeStatus();
  if (!local.ok) {
    return {
      ok: false,
      error: "missing_required_environment",
      message: `超级 AI 工厂缺少关键环境变量：${local.missing.join(", ")}。已阻止创建真实生成任务，避免 worker 空跑。`,
      missing: local.missing,
    };
  }

  const appBaseUrl = local.appBaseUrl ?? "";
  const token = process.env.SUPER_AI_FACTORY_TOKEN?.trim();
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  if (isLocalAppBaseUrl(appBaseUrl)) {
    if (local.sandboxProvider === "github" && !local.autoStartsLocalWorker) {
      return {
        ok: false,
        error: "local_worker_not_auto_started",
        message:
          "APP_BASE_URL 指向本地地址，但当前平台不会自动启动本地 GitHub 兼容 worker。已阻止创建真实任务；如需本地验证，请先 dryRun 生成创意，再手动运行 scripts/run-github-opengame-job.ts 处理指定 Job。",
        runtime: local,
      };
    }
    return null;
  }
  if (!token) {
    return {
      ok: false,
      error: "remote_preflight_token_missing",
      message: "APP_BASE_URL 指向线上地址，但本地缺少 SUPER_AI_FACTORY_TOKEN，无法确认 Railway 生产环境是否可生成，已阻止创建真实任务。",
      missing: ["SUPER_AI_FACTORY_TOKEN"],
    };
  }

  try {
    const response = await fetch(`${appBaseUrl.replace(/\/$/, "")}/api/super-ai-factory/run`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        error: "remote_preflight_failed",
        message: `超级 AI 工厂无法确认线上 Railway 环境，远端预检返回 ${response.status}。`,
      };
    }
    const remote = (await response.json()) as { runtime?: { ok?: boolean; missing?: string[] } };
    if (!remote.runtime) {
      return {
        ok: false,
        error: "remote_preflight_unavailable",
        message: "线上 Railway 还没有部署超级 AI 工厂运行时预检，已阻止创建真实生成任务。请先等待 Railway 部署最新代码。",
      };
    }
    if (remote.runtime && remote.runtime.ok === false) {
      return {
        ok: false,
        error: "remote_missing_required_environment",
        message: `Railway 生产站缺少关键环境变量：${(remote.runtime.missing ?? []).join(", ")}。已阻止创建真实生成任务。`,
        missing: remote.runtime.missing ?? [],
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: "remote_preflight_unreachable",
      message: `超级 AI 工厂无法访问 APP_BASE_URL 进行远端预检：${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  return null;
}

const FALLBACK_IDEAS: FactoryIdea[] = [
  {
    title: "尖叫鸭冲冲冲",
    contentType: "GAME",
    skeletonKey: "runner",
    brief:
      "做一个抖音爆款感的 9:16 竖屏反应跑酷小游戏《尖叫鸭冲冲冲》：玩家用 tap/空格让一只表情夸张的鸭子在三条霓虹泳道间跳跃、滑铲、躲开锅盖和泡泡陷阱，吃辣椒进入短暂狂飙。至少 5 波递进难度，每 20 秒出现一个反转机制；HUD 有连击、距离、生命、进度条；必须支持触屏、鼠标点击、键盘；失败后 1 秒内可重开。",
  },
  {
    title: "收纳大师一分钟",
    contentType: "GAME",
    skeletonKey: "puzzle",
    brief:
      "做一个手机优先的 9:16 竖屏收纳解压小游戏《收纳大师一分钟》：玩家拖拽零食、化妆品、充电线、玩偶到正确格子，形成 ASMR 式弹性动画和音效反馈。至少 4 个房间阶段，空间越来越拥挤，支持拖拽、点击自动归位、键盘快捷选择；必须有计时、星级、错放提示、撤销和重开。",
  },
  {
    title: "AI 表情包导演",
    contentType: "APPLICATION",
    skeletonKey: "auto",
    brief:
      "做一个抖音风格 9:16 竖屏轻应用《AI 表情包导演》：用户选择情绪、人物关系、热梗模板和字幕强度，应用即时生成 6 张表情包分镜卡片、短视频标题、评论区神回复和发布建议。必须有表单筛选、预览卡片、复制按钮、收藏状态、空状态和移动端顺滑交互，不要加入胜负或敌人。",
  },
  {
    title: "老板别抓我摸鱼",
    contentType: "GAME",
    skeletonKey: "stealth",
    brief:
      "做一个 9:16 竖屏潜行反应小游戏《老板别抓我摸鱼》：玩家在办公室里切换工作窗口和摸鱼窗口，躲避老板巡逻视线、同事探头和突然会议弹窗。至少 3 个工作日阶段，难度递进；支持 tap/click/键盘切换，HUD 显示摸鱼值、警觉度、剩余时间；画面要像短视频热门小游戏一样直观搞笑。",
  },
  {
    title: "爆款标题炼金炉",
    contentType: "APPLICATION",
    skeletonKey: "auto",
    brief:
      "做一个 9:16 竖屏轻应用《爆款标题炼金炉》：用户输入产品/视频主题后，通过风格滑杆、受众选择、情绪按钮生成多组短视频标题、封面文案、前三秒钩子和评论引导。必须有可编辑结果、复制、评分、重新生成、收藏列表和清晰的信息层级，移动端空间利用最大化。",
  },
];

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function factoryOwnerId() {
  return process.env.SUPER_AI_FACTORY_OWNER_ID?.trim() || "super-ai-factory";
}

function normalizeContentType(value: unknown): ContentTypeValue {
  return value === "APPLICATION" ? "APPLICATION" : "GAME";
}

function normalizeIdea(value: unknown): FactoryIdea | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim().slice(0, 40) : "";
  const brief = typeof data.brief === "string" ? data.brief.trim() : "";
  if (title.length < 2 || brief.length < 80) return null;
  return {
    title,
    brief,
    contentType: normalizeContentType(data.contentType),
    skeletonKey: typeof data.skeletonKey === "string" ? data.skeletonKey.trim() : "auto",
  };
}

function factoryTitle(metadataTitle: string | null | undefined, ideaTitle: string) {
  const title = metadataTitle?.trim();
  if (!title || /^超级\s*AI\s*工厂自动策划作品/.test(title)) return ideaTitle;
  return title;
}

function parseIdeasFromText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { ideas?: unknown[] })?.ideas) ? (parsed as { ideas: unknown[] }).ideas : [];
  return list.map(normalizeIdea).filter((idea): idea is FactoryIdea => Boolean(idea));
}

async function generateFactoryIdeas(batchSize: number) {
  const model = createMiniMaxTextModel();
  if (!model) return FALLBACK_IDEAS.slice(0, batchSize);

  const recent = await prisma.game.findMany({
    where: { tags: { has: FACTORY_TAG } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { title: true, summary: true, contentType: true },
  });

  const prompt = [
    "你是 OpenGame 的超级 AI 产品经理和短视频爆款玩法策划。",
    "请生成一批适合 HTML5/移动 WebView 的小游戏或轻应用创意，风格参考短视频平台上容易传播、容易一眼看懂、强反馈、强复玩的小产品。",
    "重要：不要声称真实抓取或复制抖音内容，只做趋势启发的原创方案。",
    "每个方案都必须能交给 OpenGame 直接生成，并通过自动试玩验证。",
    "默认手机 9:16 竖屏，720x1280 逻辑画布，触屏优先，同时兼容鼠标和键盘。",
    "游戏必须至少 3 个阶段/波次/关卡，应用必须有完整任务流、输入、预览、结果和复制/收藏反馈。",
    `本次需要 ${batchSize} 个方案，游戏和应用可以混合，但游戏不少于一半。`,
    recent.length ? `避免重复这些近期作品：${recent.map((item) => `《${item.title}》`).join("、")}` : "",
    "只返回 JSON，不要解释。格式：",
    `{"ideas":[{"title":"作品名","contentType":"GAME或APPLICATION","skeletonKey":"auto/runner/puzzle/shooter/stealth/rhythm等","brief":"完整生成 brief，包含玩法/交互/阶段/视觉/HUD/移动端要求"}]}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({ model, prompt, temperature: 0.85, maxOutputTokens: 2600 });
    const ideas = parseIdeasFromText(result.text);
    return ideas.length ? ideas.slice(0, batchSize) : FALLBACK_IDEAS.slice(0, batchSize);
  } catch (error) {
    console.warn("[super-ai-factory] Idea generation failed, using fallback ideas.", error);
    return FALLBACK_IDEAS.slice(0, batchSize);
  }
}

async function createFactoryJob(ownerId: string, idea: FactoryIdea) {
  const generationBrief = [
    `超级 AI 工厂自动策划作品：${idea.title}`,
    "",
    idea.brief,
    "",
    "发布门槛：必须通过加载、开始、点击/拖拽/键盘/触摸输入、状态变化、无 fatal JS error 的自动试玩验证。",
    "质量门槛：开屏就有完成度，非占位图，强反馈，清晰 HUD/结果页，手机 9:16 全屏体验优先。",
  ].join("\n");
  const metadata = await generateGameMetadata(generationBrief, { sourceTitle: idea.title }).catch(() =>
    fallbackGameMetadata(`游戏名叫${idea.title}。${generationBrief}`),
  );

  const game = await prisma.game.create({
    data: {
      ownerId,
      title: factoryTitle(metadata.title, idea.title),
      summary: metadata.summary,
      genre: metadata.genre,
      tags: Array.from(new Set([FACTORY_TAG, "自动生成", idea.contentType === "GAME" ? "小游戏" : "轻应用", ...metadata.tags])).slice(0, 8),
      controls: metadata.controls,
      coverPrompt: metadata.coverPrompt,
      contentType: idea.contentType,
      visibility: "PUBLIC",
      status: "GENERATING",
    },
  });

  const modelKey = normalizeGenerationModelKey(process.env.SUPER_AI_FACTORY_MODEL_KEY);
  const skeletonKey = normalizeGameplaySkeletonKey(idea.skeletonKey);
  const job = await prisma.job.create({
    data: {
      gameId: game.id,
      prompt: generationBrief,
      status: "QUEUED",
      progress: progressForJobStatus("queued"),
      modelKey,
      skeletonKey,
    },
  });

  await prisma.message.create({
    data: {
      gameId: game.id,
      role: "SYSTEM",
      jobId: job.id,
      content: [
        "超级 AI 工厂自动创建。",
        `策划名：${idea.title}`,
        `作品类型：${idea.contentType}`,
        "该作品会继续走 OpenGame 生成、自动试玩、自动修复和 READY 发布门禁。",
      ].join("\n"),
    },
  });

  await startOpenGameJob({
    gameId: game.id,
    jobId: job.id,
    prompt: generationBrief,
    modelKey,
    skeletonKey,
    contentType: idea.contentType,
  });

  return { gameId: game.id, jobId: job.id, title: game.title, contentType: game.contentType };
}

export async function runSuperAiFactory(options: FactoryRunOptions = {}) {
  const runtimeError = options.dryRun ? null : await validateFactoryRuntime();
  if (runtimeError) return runtimeError;

  const ownerId = factoryOwnerId();
  const requestedBatch = options.batchSize ?? intFromEnv("SUPER_AI_FACTORY_BATCH_SIZE", 2, 1, 5);
  const maxActive = intFromEnv("SUPER_AI_FACTORY_MAX_ACTIVE", 3, 1, 20);
  const dailyLimit = intFromEnv("SUPER_AI_FACTORY_DAILY_LIMIT", 12, 1, 100);

  await prisma.anonUser.upsert({
    where: { id: ownerId },
    update: { lastSeen: new Date() },
    create: { id: ownerId },
  });

  const [activeJobs, todayGames] = await Promise.all([
    prisma.job.count({
      where: {
        status: { in: [...ACTIVE_JOB_STATUSES] },
        game: { ownerId, tags: { has: FACTORY_TAG } },
      },
    }),
    prisma.game.count({
      where: {
        ownerId,
        tags: { has: FACTORY_TAG },
        createdAt: { gte: startOfUtcDay() },
      },
    }),
  ]);

  const capacity = Math.max(0, Math.min(requestedBatch, maxActive - activeJobs, dailyLimit - todayGames));
  if (capacity <= 0) {
    return {
      ok: true,
      created: [],
      skippedReason: "capacity_reached",
      activeJobs,
      todayGames,
      maxActive,
      dailyLimit,
    };
  }

  const ideas = await generateFactoryIdeas(capacity);
  if (options.dryRun) {
    return { ok: true, dryRun: true, ideas, activeJobs, todayGames, maxActive, dailyLimit };
  }

  const created = [];
  const creationErrors: string[] = [];
  for (const idea of ideas.slice(0, capacity)) {
    try {
      created.push(await createFactoryJob(ownerId, idea));
    } catch (error) {
      console.error("[super-ai-factory] Failed to create factory job.", error);
      creationErrors.push(
        `${idea.title}: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 240),
      );
    }
  }

  if (created.length === 0) {
    return {
      ok: false,
      error: "factory_job_creation_failed",
      message: "超级 AI 工厂已生成创意，但创建真实任务全部失败；请检查 Railway 数据库、MiniMax、GitHub dispatch 与 worker 代理环境。",
      activeJobs,
      todayGames,
      maxActive,
      dailyLimit,
      attempts: ideas.map((idea) => idea.title),
      creationErrors,
    };
  }

  return {
    ok: true,
    created,
    activeJobs,
    todayGames,
    maxActive,
    dailyLimit,
    creationErrors,
  };
}
