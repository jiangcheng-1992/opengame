import { NextRequest, NextResponse } from "next/server";
import type { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set<JobStatus>(["RUNNING", "VALIDATING", "REPAIRING", "FINISHING", "FAILED"]);

type ProgressRequest = {
  status?: string;
  log?: string;
  errorMsg?: string | null;
};

function normalizeStatus(status?: string): JobStatus {
  const normalized = (status || "RUNNING").toUpperCase() as JobStatus;
  return ALLOWED_STATUS.has(normalized) ? normalized : "RUNNING";
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as ProgressRequest;
  const status = normalizeStatus(body.status);
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

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status,
      log: typeof body.log === "string" ? body.log.slice(-8000) : job.log,
      errorMsg: body.errorMsg ?? (status === "FAILED" ? "GitHub Actions worker failed." : job.errorMsg),
      ...(status === "FAILED" ? { finishedAt: new Date() } : {}),
    },
  });

  if (status === "FAILED") {
    await prisma.game.update({
      where: { id: job.gameId },
      data: { status: job.game.playUrl ? "READY" : "FAILED" },
    });
  }

  return NextResponse.json({ ok: true });
}
