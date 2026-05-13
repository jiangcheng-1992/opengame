import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId, getClientIp } from "@/lib/auth";
import { DEFAULT_GAMEPLAY_SKELETON_KEY, normalizeGameplaySkeletonKey } from "@/lib/gameplay-skeleton";
import { progressForJobStatus } from "@/lib/job-progress";
import { enforceGenerationLimit } from "@/lib/rate-limit";
import { DEFAULT_GENERATION_MODEL_KEY, normalizeGenerationModelKey } from "@/lib/minimax-config";
import { messageSchema } from "@/lib/schemas";
import { buildSourceContext } from "@/lib/source-context";
import { retryOpenGameJob, startOpenGameJob } from "@/lib/sandbox";

const ACTIVE_JOB_STATUSES = new Set(["QUEUED", "RUNNING", "VALIDATING", "REPAIRING", "FINISHING"]);

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      messages: true,
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!game || game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  const hasPlayableVersion = Boolean(game.playUrl);
  const canUseEditWorkbench = game.status === "READY" || game.status === "FAILED" || (game.status === "GENERATING" && hasPlayableVersion);
  if (!canUseEditWorkbench) {
    return NextResponse.json({ error: "游戏生成完成或失败后才能进入修改工作台。" }, { status: 409 });
  }

  const latestJob = game.jobs[0] ?? null;
  if (latestJob && ACTIVE_JOB_STATUSES.has(latestJob.status)) {
    return NextResponse.json({ error: "这个游戏已有生成任务在进行中，请等待当前任务完成。" }, { status: 409 });
  }

  const parsed = messageSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const requestHeaders = await headers();
    await enforceGenerationLimit(anonId, getClientIp(requestHeaders));
  } catch {
    return NextResponse.json({ error: "今日生成次数已达上限。" }, { status: 429 });
  }

  const history = game.messages
    .slice(-20)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const isFailureRetry = game.status === "FAILED";
  const sourceContext = isFailureRetry ? "" : await buildSourceContext(game);
  const canUseContinue = !isFailureRetry && Boolean(game.sourceUrl);
  const prompt = isFailureRetry
    ? [
        "You are rebuilding an HTML5 game after the initial generation failed.",
        "Use the original creative intent and the user's recovery instruction to create a simpler playable version.",
        latestJob?.errorMsg ? `Previous failure reason:\n${latestJob.errorMsg}` : "Previous failure reason is unavailable.",
        `Recent conversation and confirmed brief:\n${history}`,
        `Recovery instruction:\n${parsed.data.prompt}`,
        "Produce a self-contained playable HTML5 game. Prefer a reliable single-screen version over a complex but fragile version.",
      ].join("\n\n")
    : [
        "You are modifying an existing playable HTML5 game.",
        "Preserve the core gameplay unless the user explicitly asks to change it.",
        sourceContext,
        `Recent conversation:\n${history}`,
        `Apply this change:\n${parsed.data.prompt}`,
      ].join("\n\n");
  const modelKey = normalizeGenerationModelKey(latestJob?.modelKey ?? DEFAULT_GENERATION_MODEL_KEY);
  const skeletonKey = normalizeGameplaySkeletonKey(latestJob?.skeletonKey ?? DEFAULT_GAMEPLAY_SKELETON_KEY);

  const job = await prisma.job.create({
    data: { gameId: game.id, prompt, status: "QUEUED", progress: progressForJobStatus("queued"), modelKey, skeletonKey },
  });
  await prisma.message.create({
    data: { gameId: game.id, role: "USER", content: parsed.data.prompt, jobId: job.id },
  });

  try {
    await startOpenGameJob({
      gameId: game.id,
      jobId: job.id,
      prompt,
      modelKey,
      skeletonKey,
      sourceUrl: isFailureRetry ? null : game.sourceUrl,
      useContinue: canUseContinue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改任务启动失败。";
    const retry = await retryOpenGameJob(job.id, message);
    return NextResponse.json({ jobId: retry.nextJobId ?? job.id, retrying: true });
  }

  return NextResponse.json({ jobId: job.id });
}
