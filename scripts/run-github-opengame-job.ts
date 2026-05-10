import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildPlayabilityValidatorScript } from "../lib/playability-validator-script";
import { buildOpenGameScript, buildPlayablePrompt, sandboxPaths } from "../lib/sandbox";
import { tailLines } from "../lib/status";

const execFileAsync = promisify(execFile);
const MAX_LOG_CHARS = 8000;

const requestedJobId: string | null | undefined = process.argv[2] || process.env.JOB_ID || process.env.INPUT_JOB_ID;
let claimedJobId: string | null = null;

type ClaimedJob = {
  id: string;
  gameId: string;
  prompt: string;
  sourceUrl?: string | null;
  useContinue?: boolean;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function appBaseUrl() {
  return requiredEnv("APP_BASE_URL").replace(/\/$/, "");
}

async function readText(filePath: string) {
  return readFile(filePath, "utf8").catch(() => "");
}

async function exists(filePath: string) {
  try {
    await access(filePath);
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
      log,
    }),
  });
}

async function markFailed(jobId: string, error: unknown) {
  const { log } = await currentLog();
  const fallback = error instanceof Error ? error.message : "GitHub Actions generation failed.";
  await callWorkerApi(`/api/github-worker/jobs/${jobId}/progress`, {
    method: "POST",
    body: JSON.stringify({
      status: "FAILED",
      log: (log || fallback).slice(-MAX_LOG_CHARS),
      errorMsg: tailLines(log || fallback, 40).slice(0, 2000),
    }),
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
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: Array<{ path: string; contentBase64: string }> = [];

  for (const entry of entries) {
    if (shouldIgnoreFile(entry.name)) continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listGeneratedFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push({
        path: relativePath,
        contentBase64: (await readFile(path.join(root, relativePath))).toString("base64"),
      });
    }
  }

  return files;
}

async function sourceArchiveBase64(jobId: string) {
  const archivePath = path.join("/tmp", `${jobId}.zip`);
  await rm(archivePath, { force: true });
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
    { cwd: sandboxPaths.generatedDir },
  );
  return (await readFile(archivePath)).toString("base64");
}

async function publishJob(job: ClaimedJob) {
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
  await rm(sandboxPaths.workspaceRoot, { recursive: true, force: true });
  await mkdir(sandboxPaths.workspaceRoot, { recursive: true });
  await writeFile(`${sandboxPaths.workspaceRoot}/prompt.txt`, buildPlayablePrompt(job.prompt));
  await writeFile(sandboxPaths.runScript, buildOpenGameScript());
  await chmod(sandboxPaths.runScript, 0o755);
  await writeFile(sandboxPaths.validatorScript, buildPlayabilityValidatorScript());
}

async function main() {
  const job = await claimJob();
  if (!job) {
    console.log("No queued GitHub OpenGame jobs.");
    return;
  }

  claimedJobId = job.id;
  await prepareWorkspace(job);

  const env = {
    ...process.env,
    OPENAI_API_KEY: "github-worker",
    OPENAI_BASE_URL: `${appBaseUrl()}/api/github-worker/jobs/${job.id}/openai/v1`,
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

  await publishJob(job);
}

main().catch(async (error) => {
  if (claimedJobId) await markFailed(claimedJobId, error).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
