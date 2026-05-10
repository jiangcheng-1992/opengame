import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fallbackGameMetadata } from "../lib/game-metadata";
import { generateCoverImage } from "../lib/minimax";
import { prisma } from "../lib/db";
import { buildOpenGameScript, buildPlayablePrompt, sandboxPaths } from "../lib/sandbox";
import { buildPlayabilityValidatorScript } from "../lib/playability-validator-script";
import { tailLines } from "../lib/status";
import { uploadLocalGame, uploadLocalSourceArchive } from "../lib/blob";
import { loadDotEnv } from "./load-env";

loadDotEnv();

let jobId: string | null | undefined = process.argv[2] || process.env.JOB_ID || process.env.INPUT_JOB_ID;
const MAX_LOG_CHARS = 8000;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function readText(path: string) {
  return readFile(path, "utf8").catch(() => "");
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function statusFromPhase(phase: string) {
  if (phase === "VALIDATING") return "VALIDATING" as const;
  if (phase === "REPAIRING") return "REPAIRING" as const;
  return "RUNNING" as const;
}

async function currentLog() {
  const [progress, validation, error, phase] = await Promise.all([
    readText(sandboxPaths.progressLog),
    readText(sandboxPaths.validationLog),
    readText(sandboxPaths.errorLog),
    readText(sandboxPaths.phaseFile),
  ]);

  return {
    phase: phase.trim(),
    log: [
      progress.trim(),
      validation.trim() ? `[validation log]\n${validation.trim()}` : "",
      error.trim() ? `[error log]\n${tailLines(error.trim(), 20)}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(-MAX_LOG_CHARS),
  };
}

async function syncProgress(jobId: string) {
  const { phase, log } = await currentLog();
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: statusFromPhase(phase),
      log,
    },
  });
}

async function runOpenGameProcess(env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn("bash", [sandboxPaths.runScript], {
      env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function markFailed(jobId: string, gameId: string, error: unknown) {
  const { log } = await currentLog();
  const fallback = error instanceof Error ? error.message : "GitHub Actions generation failed.";
  const errorMsg = tailLines(log || fallback, 40).slice(0, 2000);
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { playUrl: true } });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      log: log || fallback,
      errorMsg,
      finishedAt: new Date(),
    },
  });
  await prisma.game.update({
    where: { id: gameId },
    data: { status: game?.playUrl ? "READY" : "FAILED" },
  });
}

async function resolveJobId() {
  if (jobId) return jobId;

  const queuedJob = await prisma.job.findFirst({
    where: {
      status: "QUEUED",
      sandboxId: { startsWith: "github:" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return queuedJob?.id ?? null;
}

async function main() {
  requiredEnv("DATABASE_URL");
  requiredEnv("BLOB_READ_WRITE_TOKEN");
  requiredEnv("MINIMAX_API_KEY");

  jobId = await resolveJobId();
  if (!jobId) {
    console.log("No queued GitHub OpenGame jobs.");
    return;
  }

  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { game: true } });
  if (!job) throw new Error(`Job ${jobId} was not found.`);
  if (job.status === "DONE") return;

  await rm(sandboxPaths.workspaceRoot, { recursive: true, force: true });
  await mkdir(sandboxPaths.workspaceRoot, { recursive: true });
  await writeFile(`${sandboxPaths.workspaceRoot}/prompt.txt`, buildPlayablePrompt(job.prompt));
  await writeFile(sandboxPaths.runScript, buildOpenGameScript());
  await chmod(sandboxPaths.runScript, 0o755);
  await writeFile(sandboxPaths.validatorScript, buildPlayabilityValidatorScript());

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      sandboxId: `github:${job.id}`,
      startedAt: job.startedAt ?? new Date(),
      finishedAt: null,
      errorMsg: null,
      log: "GitHub Actions runner started.",
    },
  });
  await prisma.game.update({ where: { id: job.gameId }, data: { status: "GENERATING" } });

  const env = {
    ...process.env,
    OPENAI_API_KEY: process.env.MINIMAX_API_KEY ?? "",
    OPENAI_BASE_URL: process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
    OPENAI_MODEL: process.env.MINIMAX_TEXT_MODEL || "MiniMax-M2.7",
    GAME_TEMPLATES_DIR: `${sandboxPaths.opengameRoot}/agent-test/templates`,
    GAME_DOCS_DIR: `${sandboxPaths.opengameRoot}/agent-test/docs`,
    OPENGAME_SOURCE_URL: job.sourceUrl ?? "",
    OPENGAME_USE_CONTINUE: job.useContinue ? "1" : "",
  };

  const interval = setInterval(() => {
    syncProgress(job.id).catch((error) => console.error("[progress]", error));
  }, 5000);

  let exitCode = 1;
  try {
    exitCode = await runOpenGameProcess(env);
  } finally {
    clearInterval(interval);
  }

  await syncProgress(job.id);

  const playable = await exists(sandboxPaths.playableMarker);
  const indexExists = await exists(`${sandboxPaths.generatedDir}/index.html`);
  if (exitCode !== 0 || !playable || !indexExists) {
    const { log } = await currentLog();
    throw new Error(log || `OpenGame exited with ${exitCode}.`);
  }

  const { log } = await currentLog();
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "RUNNING", log: `${log}\n[github] Uploading playable files...`.slice(-MAX_LOG_CHARS) },
  });

  const [{ playUrl }, sourceUrl] = await Promise.all([
    uploadLocalGame({ gameId: job.gameId, root: sandboxPaths.generatedDir }),
    uploadLocalSourceArchive({ gameId: job.gameId, root: sandboxPaths.generatedDir }).catch(() => null),
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
  const coverUrl = await generateCoverImage(job.gameId, metadata).catch(() => null);

  await prisma.$transaction([
    prisma.game.update({
      where: { id: job.gameId },
      data: {
        status: "READY",
        playUrl,
        sourceUrl,
        title: metadata.title,
        summary: metadata.summary,
        genre: metadata.genre,
        tags: metadata.tags,
        controls: metadata.controls,
        coverPrompt: metadata.coverPrompt,
        ...(coverUrl ? { coverUrl } : {}),
      },
    }),
    prisma.job.update({
      where: { id: job.id },
      data: { status: "DONE", log: `${log}\n[github] Game published.`.slice(-MAX_LOG_CHARS), finishedAt: new Date() },
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
}

main()
  .catch(async (error) => {
    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (job) await markFailed(job.id, job.gameId, error);
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
