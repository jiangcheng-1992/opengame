import { after, NextRequest, NextResponse } from "next/server";
import { uploadGameFileBuffers, uploadSourceArchiveBuffer } from "@/lib/blob";
import { prisma } from "@/lib/db";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { mergeProgress, progressForJobStatus } from "@/lib/job-progress";
import { generateCoverImage } from "@/lib/minimax";
import { retryOpenGameJob } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

type PublishFile = {
  path: string;
  contentBase64: string;
};

type PublishRequest = {
  files?: PublishFile[];
  sourceArchiveBase64?: string | null;
  log?: string;
};

function decodeFiles(files: PublishFile[]) {
  return files.map((file) => ({
    path: file.path,
    body: Buffer.from(file.contentBase64, "base64"),
  }));
}

function generateCoverAfterPublish(gameId: string, metadata: Parameters<typeof generateCoverImage>[1]) {
  after(async () => {
    try {
      const coverUrl = await generateCoverImage(gameId, metadata);
      if (coverUrl) await prisma.game.update({ where: { id: gameId }, data: { coverUrl } });
    } catch (error) {
      console.warn("[cover] Background cover generation failed.", error);
    }
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as PublishRequest;
  const job = await prisma.job.findFirst({
    where: {
      id,
      sandboxId: { startsWith: "github:" },
    },
    include: { game: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "No generated files supplied." }, { status: 400 });
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "FINISHING",
      progress: mergeProgress(job.progress, progressForJobStatus("finishing")),
      log: body.log?.slice(-8000) ?? job.log,
    },
  });

  try {
    const [{ playUrl }, sourceUrl] = await Promise.all([
      uploadGameFileBuffers({ gameId: job.gameId, files: decodeFiles(body.files) }),
      body.sourceArchiveBase64
        ? uploadSourceArchiveBuffer({
            gameId: job.gameId,
            body: Buffer.from(body.sourceArchiveBase64, "base64"),
          }).catch(() => null)
        : Promise.resolve(null),
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
    generateCoverAfterPublish(job.gameId, metadata);

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
        },
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          progress: 100,
          log: [body.log, "[github] Game published."].filter(Boolean).join("\n").slice(-8000),
          finishedAt: new Date(),
        },
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

    return NextResponse.json({ ok: true, playUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    const retry = await retryOpenGameJob(job.id, message, { log: body.log });
    return NextResponse.json({ error: message, retrying: true, ...retry }, { status: 202 });
  }
}
