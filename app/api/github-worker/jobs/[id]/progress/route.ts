import { NextRequest, NextResponse } from "next/server";
import type { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { retryOpenGameJob } from "@/lib/sandbox";

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

  if (status === "FAILED") {
    const log = typeof body.log === "string" ? body.log.slice(-8000) : job.log;
    const errorMsg = body.errorMsg ?? "GitHub Actions worker failed.";
    const retry = await retryOpenGameJob(job.id, errorMsg, { log });
    return NextResponse.json({ ok: true, retrying: true, ...retry });
  }

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status,
      log: typeof body.log === "string" ? body.log.slice(-8000) : job.log,
      errorMsg: body.errorMsg ?? job.errorMsg,
    },
  });

  return NextResponse.json({ ok: true });
}
