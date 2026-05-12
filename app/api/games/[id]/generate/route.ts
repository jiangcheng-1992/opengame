import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAnonId, getClientIp } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceGenerationLimit } from "@/lib/rate-limit";
import { createArtEnhancement } from "@/lib/art-enhancement";
import { generateGameMetadata } from "@/lib/game-metadata";
import { generateDraftSchema } from "@/lib/schemas";
import { startOpenGameJob } from "@/lib/sandbox";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const generationPrompt = artEnhancement?.generationPrompt ?? parsed.data.brief;
  const systemMessage = [
    `确认用于生成的需求:\n${parsed.data.brief}`,
    artEnhancement?.systemMessage ?? "AI 美术增强: 未开启",
  ].join("\n\n");
  const [job] = await prisma.$transaction([
    prisma.job.create({
      data: {
        gameId: game.id,
        prompt: generationPrompt,
        status: "QUEUED",
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
    await startOpenGameJob({ gameId: game.id, jobId: job.id, prompt: generationPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成任务启动失败。";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: message, finishedAt: new Date() },
    });
    await prisma.game.update({ where: { id: game.id }, data: { status: "FAILED" } });
    return NextResponse.json({ error: message, gameId: game.id, jobId: job.id }, { status: 500 });
  }

  return NextResponse.json({ gameId: game.id, jobId: job.id });
}
