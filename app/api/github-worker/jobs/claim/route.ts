import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mergeProgress, progressForJobStatus } from "@/lib/job-progress";

export const dynamic = "force-dynamic";

type ClaimRequest = {
  jobId?: string | null;
};

async function findQueuedJob(jobId?: string | null) {
  if (jobId) {
    return prisma.job.findFirst({
      where: {
        id: jobId,
        status: "QUEUED",
        sandboxId: { startsWith: "github:" },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  return prisma.job.findFirst({
    where: {
      status: "QUEUED",
      sandboxId: { startsWith: "github:" },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ClaimRequest;
  const candidate = await findQueuedJob(body.jobId);

  if (!candidate) {
    return NextResponse.json({ job: null });
  }

  const claimed = await prisma.job.updateMany({
    where: {
      id: candidate.id,
      status: "QUEUED",
      sandboxId: { startsWith: "github:" },
    },
    data: {
      status: "RUNNING",
      progress: mergeProgress(candidate.progress, progressForJobStatus("running")),
      startedAt: new Date(),
      log: "GitHub Actions runner claimed this job.",
    },
  });

  if (claimed.count !== 1) {
    return NextResponse.json({ job: null });
  }

  const job = await prisma.job.findUniqueOrThrow({ where: { id: candidate.id }, include: { game: { select: { contentType: true } } } });

  return NextResponse.json({
    job: {
      id: job.id,
      gameId: job.gameId,
      modelKey: job.modelKey,
      skeletonKey: job.skeletonKey,
      contentType: job.game.contentType,
      prompt: job.prompt,
      sourceUrl: job.sourceUrl,
      useContinue: job.useContinue,
    },
  });
}
