import { execFile, spawn } from "node:child_process";
import { access, appendFile, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeGameplaySkeletonKey, type GameplaySkeletonKey } from "../lib/gameplay-skeleton";
import { normalizeContentType, type ContentTypeValue } from "../lib/content-type";
import { progressFromPhaseAndLog } from "../lib/job-progress";
import { getOpenGameModelForKey } from "../lib/minimax-config";
import { buildPlayabilityValidatorScript } from "../lib/playability-validator-script";
import { buildOpenGameScript, buildPlayablePrompt, sandboxPaths } from "../lib/sandbox";
import { tailLines } from "../lib/status";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const execFileAsync = promisify(execFile);
const MAX_LOG_CHARS = 8000;
const MAX_GENERATION_ATTEMPTS = Math.max(1, Number(process.env.OPENGAME_WORKER_MAX_ATTEMPTS || "1") || 1);

const requestedJobId: string | null | undefined = process.argv[2] || process.env.JOB_ID || process.env.INPUT_JOB_ID;
let claimedJobId: string | null = null;

type ClaimedJob = {
  id: string;
  gameId: string;
  modelKey?: string | null;
  skeletonKey?: GameplaySkeletonKey | null;
  contentType?: ContentTypeValue | null;
  prompt: string;
  sourceUrl?: string | null;
  useContinue?: boolean;
};

type FailureReport = {
  retrying?: boolean;
  status?: string;
  nextJobId?: string;
};

function appBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function hostPath(filePath: string) {
  if (process.platform !== "win32" || !filePath.startsWith("/tmp/")) return filePath;
  return path.join(tmpdir(), filePath.slice("/tmp/".length));
}

async function readText(filePath: string) {
  return readFile(hostPath(filePath), "utf8").catch(() => "");
}

async function appendProgressLog(message: string) {
  const timestamp = new Date().toISOString();
  await appendFile(hostPath(sandboxPaths.progressLog), `[worker][${timestamp}] ${message}\n`).catch(() => undefined);
}

async function exists(filePath: string) {
  try {
    await access(hostPath(filePath));
    return true;
  } catch {
    return false;
  }
}

function statusFromPhase(phase: string) {
  if (phase === "VALIDATING") return "VALIDATING";
  if (phase === "REPAIRING") return "REPAIRING";
  return "RUNNING";
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

async function callWorkerApi<T>(pathname: string, init?: RequestInit) {
  const response = await fetch(`${appBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Worker API ${pathname} failed with HTTP ${response.status}.\n${detail}`.trim());
  }

  return (await response.json()) as T;
}

async function claimJob() {
  const payload = await callWorkerApi<{ job: ClaimedJob | null }>("/api/github-worker/jobs/claim", {
    method: "POST",
    body: JSON.stringify({ jobId: requestedJobId || null }),
  });

  return payload.job;
}

async function syncProgress(jobId: string) {
  const { phase, log } = await currentLog();
  await callWorkerApi(`/api/github-worker/jobs/${jobId}/progress`, {
    method: "POST",
    body: JSON.stringify({
      status: statusFromPhase(phase),
      progress: progressFromPhaseAndLog(statusFromPhase(phase), log),
      log,
    }),
  });
}

async function markFailed(jobId: string, error: unknown) {
  const { log } = await currentLog();
  const fallback = error instanceof Error ? error.message : "GitHub Actions generation failed.";
  return callWorkerApi<FailureReport>(`/api/github-worker/jobs/${jobId}/progress`, {
    method: "POST",
    body: JSON.stringify({
      status: "FAILED",
      log: (log || fallback).slice(-MAX_LOG_CHARS),
      errorMsg: tailLines(log || fallback, 40).slice(0, 2000),
    }),
  });
}

function promptForAttempt(prompt: string, attempt: number, skeletonKey?: GameplaySkeletonKey, contentType?: ContentTypeValue | null) {
  const normalizedSkeletonKey = normalizeGameplaySkeletonKey(skeletonKey);
  const normalizedContentType = normalizeContentType(contentType);
  if (attempt <= 1) return buildPlayablePrompt(prompt, normalizedSkeletonKey, normalizedContentType);

  return buildPlayablePrompt(
    [
      prompt,
      "",
      `Reliability retry ${attempt}/${MAX_GENERATION_ATTEMPTS}: the previous generated output did not pass playable validation.`,
      "Prioritize a working, validated game over ambition. Simplify the mechanics, reduce asset/code complexity, and ship a stable core loop.",
      "The final answer must include a playable index.html that passes start/click/keyboard smoke validation.",
      "Do not create or run Playwright, Puppeteer, Selenium, npm test, smoke_test, test.js, or any browser-download test harness; the platform validates the result after generation.",
      "Do not spend tokens narrating plans, checklists, or self-tests. Modify the playable files directly and finish quickly.",
      "It must also pass product-grade visual validation: non-pixel-art, no 8-bit/blocky/pixelated styling, a designed hero/start screen, a readable multi-module HUD, a replay-ready end-state overlay, polished modern UI, gradients, rounded controls, shadows/glow, strong spacing hierarchy, and responsive layout.",
      "Preserve premium UI polish while simplifying: consistent design system, layered background, authored game objects, tactile hit/miss/blocked feedback, mobile-safe composition, and a curated result screen.",
      "Reduce scope if needed, but the result must feel premium and curated, similar to a high-quality arcade template rather than a raw prototype.",
    ].join("\n"),
    normalizedSkeletonKey,
    normalizedContentType,
  );
}

function bashCommand() {
  if (process.platform !== "win32") return "bash";

  const candidates = [
    process.env.GIT_BASH_PATH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) || "bash";
}

async function runOpenGameProcess(env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(bashCommand(), [sandboxPaths.runScript], {
      env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function shouldIgnoreFile(name: string) {
  return (
    name === "node_modules" ||
    name === ".git" ||
    name === "playwright-report" ||
    name === "test-results" ||
    name.endsWith(".log")
  );
}

async function listGeneratedFiles(root: string, prefix = ""): Promise<Array<{ path: string; contentBase64: string }>> {
  const entries = await readdir(path.join(hostPath(root), prefix), { withFileTypes: true });
  const files: Array<{ path: string; contentBase64: string }> = [];

  for (const entry of entries) {
    if (shouldIgnoreFile(entry.name)) continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listGeneratedFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push({
        path: relativePath,
        contentBase64: (await readFile(path.join(hostPath(root), relativePath))).toString("base64"),
      });
    }
  }

  return files;
}

async function sourceArchiveBase64(jobId: string) {
  const archivePath = path.join("/tmp", `${jobId}.zip`);
  await rm(hostPath(archivePath), { force: true });
  await execFileAsync(
    "zip",
    [
      "-qr",
      archivePath,
      ".",
      "-x",
      "node_modules/*",
      "-x",
      "*/node_modules/*",
      "-x",
      ".git/*",
      "-x",
      "*/.git/*",
      "-x",
      "playwright-report/*",
      "-x",
      "test-results/*",
      "-x",
      "*.log",
    ],
    { cwd: hostPath(sandboxPaths.generatedDir) },
  );
  return (await readFile(hostPath(archivePath))).toString("base64");
}

async function publishJob(job: ClaimedJob) {
  await appendProgressLog("Publishing only after playable marker and index.html are present.");
  const { log } = await currentLog();
  await callWorkerApi(`/api/github-worker/jobs/${job.id}/publish`, {
    method: "POST",
    body: JSON.stringify({
      files: await listGeneratedFiles(sandboxPaths.generatedDir),
      sourceArchiveBase64: await sourceArchiveBase64(job.id).catch(() => null),
      log: `${log}\n[github] Uploading playable files...`.slice(-MAX_LOG_CHARS),
    }),
  });
}

async function prepareWorkspace(job: ClaimedJob) {
  await mkdir(hostPath(sandboxPaths.workspaceRoot), { recursive: true });
  await Promise.all([
    rm(hostPath(sandboxPaths.generatedDir), { recursive: true, force: true }),
    rm(hostPath(sandboxPaths.progressLog), { force: true }),
    rm(hostPath(sandboxPaths.errorLog), { force: true }),
    rm(hostPath(sandboxPaths.phaseFile), { force: true }),
    rm(hostPath(sandboxPaths.validationLog), { force: true }),
    rm(hostPath(sandboxPaths.validationReport), { force: true }),
    rm(hostPath(sandboxPaths.playableMarker), { force: true }),
    rm(hostPath(`${sandboxPaths.workspaceRoot}/source.zip`), { force: true }),
    rm(hostPath(`${sandboxPaths.workspaceRoot}/original-prompt.txt`), { force: true }),
  ]);
  await writeFile(hostPath(`${sandboxPaths.workspaceRoot}/prompt.txt`), promptForAttempt(job.prompt, 1, job.skeletonKey ?? undefined, job.contentType));
  await writeFile(hostPath(sandboxPaths.runScript), buildOpenGameScript());
  await chmod(hostPath(sandboxPaths.runScript), 0o755);
  await writeFile(hostPath(sandboxPaths.validatorScript), buildPlayabilityValidatorScript());
  await appendProgressLog(`Prepared workspace for game=${job.gameId}, model=${job.modelKey || "default"}, skeleton=${job.skeletonKey || "auto"}, contentType=${normalizeContentType(job.contentType)}.`);
  await appendProgressLog("Quality plan injected: visual director, premium UI system, mobile-safe composition, feedback cues, and validator polish gate.");
}

async function runUntilPlayable(job: ClaimedJob, env: NodeJS.ProcessEnv) {
  let lastLog = "";

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      console.log(`[github-worker] Retry ${attempt}/${MAX_GENERATION_ATTEMPTS}: regenerating with a simpler playable-first prompt.`);
      await appendProgressLog(`Reliability retry ${attempt}/${MAX_GENERATION_ATTEMPTS}: previous build failed validation, regenerating with repair-focused quality prompt.`);
      await rm(hostPath(sandboxPaths.generatedDir), { recursive: true, force: true });
      await writeFile(hostPath(`${sandboxPaths.workspaceRoot}/prompt.txt`), promptForAttempt(job.prompt, attempt, job.skeletonKey ?? undefined, job.contentType));
    }

    await appendProgressLog(`Starting OpenGame attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}; enforcing playable core loop, visual polish, HUD, result screen, and responsive layout.`);
    const exitCode = await runOpenGameProcess({
      ...env,
      OPENGAME_RELIABILITY_ATTEMPT: String(attempt),
    });
    await syncProgress(job.id);

    const playable = await exists(sandboxPaths.playableMarker);
    const indexExists = await exists(`${sandboxPaths.generatedDir}/index.html`);
    await appendProgressLog(`Attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} finished: exitCode=${exitCode}, playable=${playable}, indexHtml=${indexExists}.`);
    if (exitCode === 0 && playable && indexExists) return;

    const { log } = await currentLog();
    lastLog = log || `OpenGame exited with ${exitCode}.`;
  }

  throw new Error(lastLog || "OpenGame did not produce a playable build after reliability retries.");
}

async function main() {
  console.log(`[github-worker] APP_BASE_URL=${appBaseUrl()}`);
  console.log(`[github-worker] Claiming ${requestedJobId ? `job ${requestedJobId}` : "the oldest queued GitHub OpenGame job"}...`);

  const job = await claimJob();
  if (!job) {
    console.log("No queued GitHub OpenGame jobs. Create a game locally, then run this command again.");
    return;
  }

  claimedJobId = job.id;
  console.log(`[github-worker] Claimed job ${job.id} for game ${job.gameId}.`);
  await prepareWorkspace(job);

  const env = {
    ...process.env,
    OPENAI_API_KEY: "github-worker",
    OPENAI_BASE_URL: `${appBaseUrl()}/api/github-worker/jobs/${job.id}/openai/v1`,
    OPENAI_MODEL: getOpenGameModelForKey(job.modelKey),
    GAME_TEMPLATES_DIR: `${sandboxPaths.opengameRoot}/agent-test/templates`,
    GAME_DOCS_DIR: `${sandboxPaths.opengameRoot}/agent-test/docs`,
    OPENGAME_SOURCE_URL: job.sourceUrl ?? "",
    OPENGAME_USE_CONTINUE: job.useContinue ? "1" : "",
  };

  const interval = setInterval(() => {
    syncProgress(job.id).catch((error) => console.error("[progress]", error));
  }, 2000);

  try {
    await runUntilPlayable(job, env);
  } finally {
    clearInterval(interval);
  }

  await publishJob(job);
}

main().catch(async (error) => {
  if (claimedJobId) {
    const failureReport = await markFailed(claimedJobId, error).catch(() => null);
    if (failureReport?.retrying && failureReport.status !== "failed") {
      console.log(
        `[github-worker] Current attempt failed, but a follow-up retry job was queued${failureReport.nextJobId ? `: ${failureReport.nextJobId}` : ""}.`,
      );
      console.log("[github-worker] Treating this workflow run as recovered to avoid false failure notifications.");
      return;
    }
  }
  console.error(error);
  process.exitCode = 1;
});
