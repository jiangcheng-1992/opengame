import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { uploadSandboxGame, uploadSourceArchive } from "@/lib/blob";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { generateCoverImage } from "@/lib/minimax";
import { hasPlayableBuild, retryOpenGameJob, sandboxPaths, stopSandbox } from "@/lib/sandbox";
import { describeSandboxError } from "@/lib/vercel-sandbox-auth";

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timeout: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timeout));
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await prisma.job.findUnique({ where: { id }, include: { game: true } });

  if (!job) {
    return NextResponse.json({ error: "找不到这个任务。" }, { status: 404 });
  }

  if (job.status === "DONE" && job.game.playUrl) {
    return NextResponse.json({ ok: true, playUrl: job.game.playUrl });
  }

  if (job.sandboxId?.startsWith("github:")) {
    return NextResponse.json({ error: "GitHub Actions worker 会直接发布结果。" }, { status: 409 });
  }

  if (!job.sandboxId) {
    return NextResponse.json({ error: "缺少 Sandbox 标识。" }, { status: 400 });
  }

  try {
    const readyToPublish = await withTimeout(
      hasPlayableBuild(job.sandboxId),
      60_000,
      "可玩性检查超时。",
    );
    if (!readyToPublish) {
      return NextResponse.json({ error: "可玩性验证还没有通过。" }, { status: 409 });
    }

    const [{ playUrl }, sourceUrl] = await Promise.all([
      withTimeout(
        uploadSandboxGame({
          sandboxId: job.sandboxId,
          gameId: job.gameId,
          root: sandboxPaths.generatedDir,
        }),
        4 * 60_000,
        "发布游戏文件超时。",
      ),
      withTimeout(
        uploadSourceArchive({
          sandboxId: job.sandboxId,
          gameId: job.gameId,
          root: sandboxPaths.generatedDir,
        }),
        4 * 60_000,
        "发布源码包超时。",
      ).catch(() => null),
    ]);

    const metadata =
      job.game.summary && job.game.genre
        ? {
            title: job.game.title,
            summary: job.game.summary,
            genre: job.game.genre,
            tags: job.game.tags,
            controls: job.game.controls,
            coverPrompt: job.game.coverPrompt ?? "",
          }
        : fallbackGameMetadata(job.prompt);
    const coverUrl = await withTimeout(
      generateCoverImage(job.gameId, metadata),
      60_000,
      "封面图生成超时。",
    ).catch(() => null);

    await prisma.$transaction([
      prisma.game.update({
        where: { id: job.gameId },
        data: {
          status: "READY",
          playUrl,
          sourceUrl: sourceUrl ?? job.game.sourceUrl,
          title: metadata.title,
          summary: metadata.summary,
          genre: metadata.genre,
          tags: metadata.tags,
          controls: metadata.controls,
          coverPrompt: metadata.coverPrompt,
          ...(job.game.playUrl ? { version: { increment: 1 } } : {}),
          ...(coverUrl ? { coverUrl } : {}),
        },
      }),
      prisma.job.update({
        where: { id: job.id },
        data: { status: "DONE", finishedAt: new Date() },
      }),
      prisma.message.create({
        data: {
          gameId: job.gameId,
          role: "AGENT",
          content: "游戏已生成并发布。",
          jobId: job.id,
        },
      }),
    ]);

    await stopSandbox(job.sandboxId).catch(() => undefined);
    return NextResponse.json({ ok: true, playUrl });
  } catch (error) {
    const message = describeSandboxError(error);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    const retry = await retryOpenGameJob(job.id, message);
    return NextResponse.json({ error: message, retrying: true, ...retry }, { status: 202 });
  }
}
