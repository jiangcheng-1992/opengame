import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId, getClientIp } from "@/lib/auth";
import { enforceGenerationLimit } from "@/lib/rate-limit";
import { messageSchema } from "@/lib/schemas";
import { buildSourceContext } from "@/lib/source-context";
import { startOpenGameJob } from "@/lib/sandbox";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({ where: { id }, include: { messages: true } });

  if (!game || game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  if (game.status !== "READY") {
    return NextResponse.json({ error: "游戏生成完成后才能继续修改。" }, { status: 409 });
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
  const sourceContext = await buildSourceContext(game);
  const prompt = [
    "You are modifying an existing playable HTML5 game.",
    "Preserve the core gameplay unless the user explicitly asks to change it.",
    sourceContext,
    `Recent conversation:\n${history}`,
    `Apply this change:\n${parsed.data.prompt}`,
  ].join("\n\n");

  const job = await prisma.job.create({
    data: { gameId: game.id, prompt, status: "QUEUED" },
  });
  await prisma.message.create({
    data: { gameId: game.id, role: "USER", content: parsed.data.prompt, jobId: job.id },
  });

  try {
    await startOpenGameJob({
      gameId: game.id,
      jobId: job.id,
      prompt,
      sourceUrl: game.sourceUrl,
      useContinue: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改任务启动失败。";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: message, finishedAt: new Date() },
    });
    return NextResponse.json({ error: message, jobId: job.id }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id });
}
