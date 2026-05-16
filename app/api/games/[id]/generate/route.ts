import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAnonId, getClientIp, requireAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceGenerationLimit } from "@/lib/rate-limit";
import { createArtEnhancement } from "@/lib/art-enhancement";
import { generateGameMetadata } from "@/lib/game-metadata";
import { progressForJobStatus } from "@/lib/job-progress";
import { generateDraftSchema } from "@/lib/schemas";
import { retryOpenGameJob, startOpenGameJob } from "@/lib/sandbox";
import { contentTypeLabel } from "@/lib/content-type";

function buildContentTypePrompt(brief: string, contentType: "GAME" | "APPLICATION") {
  if (contentType === "GAME") return brief;

  return [
    "作品类型: APPLICATION / 应用。",
    "请生成一个发布级 HTML5 互动应用，而不是游戏。",
    "应用要求：围绕用户需求提供清晰的信息架构、输入/筛选/编辑/预览/保存等核心任务流；可以有互动反馈和成就感，但不要强行加入胜负、关卡、敌人、生命值或游戏化通关。",
    "质量要求：移动端优先、桌面自适应、完整可见；包含精致首页/工具主界面/结果或详情状态；按钮、表单、卡片、空状态、错误提示和加载反馈都要完整。",
    "用户应用需求:",
    brief,
  ].join("\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  if (!account) {
    return NextResponse.json({ error: "请先登录后再生成游戏。" }, { status: 401 });
  }
  const [{ id }, anonId, requestHeaders] = await Promise.all([params, getAnonId(), headers()]);
  const parsed = generateDraftSchema.safeParse(await req.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到这个草稿。" }, { status: 404 });
  }

  if (game.status !== "DRAFT") {
    return NextResponse.json({ error: "这个草稿已经启动过生成。" }, { status: 409 });
  }

  try {
    await enforceGenerationLimit(anonId, getClientIp(requestHeaders));
  } catch {
    return NextResponse.json({ error: "今日生成次数已达上限。" }, { status: 429 });
  }

  const metadata = await generateGameMetadata(parsed.data.brief);
  const artEnhancement = parsed.data.artEnhancementEnabled
    ? await createArtEnhancement({
        gameId: game.id,
        brief: parsed.data.brief,
        coverPrompt: metadata.coverPrompt,
      })
    : null;
  const baseGenerationPrompt = artEnhancement?.generationPrompt ?? parsed.data.brief;
  const generationPrompt = buildContentTypePrompt(baseGenerationPrompt, parsed.data.contentType);
  const systemMessage = [
    `确认用于生成的需求:\n${parsed.data.brief}`,
    `作品类型: ${contentTypeLabel(parsed.data.contentType)}`,
    artEnhancement?.systemMessage ?? "AI 美术增强: 未开启",
  ].join("\n\n");
  const modelKey = parsed.data.modelKey;
  const skeletonKey = parsed.data.skeletonKey;
  const [job] = await prisma.$transaction([
    prisma.job.create({
      data: {
        gameId: game.id,
        prompt: generationPrompt,
        status: "QUEUED",
        progress: progressForJobStatus("queued"),
        modelKey,
        skeletonKey,
      },
    }),
    prisma.game.update({
      where: { id: game.id },
      data: {
        title: metadata.title,
        summary: metadata.summary,
        genre: metadata.genre,
        tags: metadata.tags,
        controls: metadata.controls,
        coverPrompt: artEnhancement?.coverPrompt ?? metadata.coverPrompt,
        visibility: parsed.data.visibility,
        contentType: parsed.data.contentType,
      },
    }),
    prisma.message.create({
      data: {
        gameId: game.id,
        role: "SYSTEM",
        content: systemMessage,
      },
    }),
  ]);

  try {
    await startOpenGameJob({ gameId: game.id, jobId: job.id, prompt: generationPrompt, modelKey, skeletonKey, contentType: parsed.data.contentType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成任务启动失败。";
    const retry = await retryOpenGameJob(job.id, message);
    return NextResponse.json({ gameId: game.id, jobId: retry.nextJobId ?? job.id, retrying: true });
  }

  return NextResponse.json({ gameId: game.id, jobId: job.id });
}
