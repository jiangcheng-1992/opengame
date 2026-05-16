import { spawn } from "node:child_process";
import path from "node:path";
import { prisma } from "@/lib/db";
import { inferGameplaySkeletonKey, normalizeGameplaySkeletonKey, type GameplaySkeletonKey } from "@/lib/gameplay-skeleton";
import { maybeTriggerGithubOpenGameWorkflow } from "@/lib/github-actions";
import { mergeProgress, progressForJobStatus, progressFromPhaseAndLog } from "@/lib/job-progress";
import { getOpenGameModelForKey, normalizeGenerationModelKey, type GenerationModelKey } from "@/lib/minimax-config";
import { buildPlayabilityValidatorScript } from "@/lib/playability-validator-script";
import { tailLines } from "@/lib/status";
import { normalizeContentType, type ContentTypeValue } from "@/lib/content-type";
import {
  describeSandboxError,
  isSandboxUnrecoverableProvisioningError,
  sandboxCredentialsFromEnv,
} from "@/lib/vercel-sandbox-auth";

const WORKSPACE_ROOT = "/tmp/opengame-workspace";
const OPENGAME_ROOT = `${WORKSPACE_ROOT}/opengame`;
const GENERATED_DIR = `${WORKSPACE_ROOT}/game`;
const PROGRESS_LOG = `${WORKSPACE_ROOT}/progress.log`;
const ERROR_LOG = `${WORKSPACE_ROOT}/error.log`;
const EXIT_CODE_FILE = `${WORKSPACE_ROOT}/exit_code`;
const PHASE_FILE = `${WORKSPACE_ROOT}/phase`;
const VALIDATION_LOG = `${WORKSPACE_ROOT}/validation.log`;
const VALIDATION_REPORT = `${WORKSPACE_ROOT}/validation-report.json`;
const PLAYABLE_MARKER = `${WORKSPACE_ROOT}/playable`;
const RUN_SCRIPT = `${WORKSPACE_ROOT}/run-opengame.sh`;
const VALIDATOR_SCRIPT = `${WORKSPACE_ROOT}/validate-playable.mjs`;
const MAX_JOB_MS = 30 * 60 * 1000;
const MAX_REPAIR_ATTEMPTS = 2;
const MAX_AUTOMATIC_RETRY_JOBS = 2;
const AUTO_RETRY_MESSAGE_PREFIX = "生成未发布 READY 版本，已自动重试。";
const RETRY_LIMIT_LOG_MARKER = "[retry] Automatic retry limit reached.";
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "VALIDATING", "REPAIRING", "FINISHING"] as const;
const localGithubWorkerJobs = new Set<string>();

type SandboxProvider = "github" | "e2b" | "vercel";

type SandboxHandle = {
  sandboxId?: string;
  runCommand: (input: unknown) => Promise<unknown>;
  readFile?: (
    file: { path: string; cwd?: string } | string,
  ) => Promise<ReadableStream<Uint8Array> | NodeJS.ReadableStream | string | Uint8Array | null>;
  writeFiles?: (files: Array<{ path: string; content: Buffer }>) => Promise<unknown>;
  stop?: () => Promise<unknown>;
};

type CommandInput = {
  cmd?: unknown;
  args?: unknown;
  env?: unknown;
  detached?: unknown;
};

function sandboxProviderFromEnv(): SandboxProvider {
  const provider = (process.env.SANDBOX_PROVIDER || "github").trim().toLowerCase();
  if (provider === "github") return "github";
  if (provider === "vercel") return "vercel";
  return "e2b";
}

function githubDispatchRepoFromEnv() {
  const explicit = process.env.GITHUB_DISPATCH_REPO?.trim();
  if (explicit) return explicit;

  const owner = process.env.GITHUB_DISPATCH_OWNER?.trim() || process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug = process.env.GITHUB_DISPATCH_REPO_SLUG?.trim() || process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (owner && slug) return `${owner}/${slug}`;

  return process.env.GITHUB_REPOSITORY?.trim() || "";
}

function queuedGithubWorkerLog() {
  if (process.env.VERCEL) return "Queued for the next scheduled GitHub Actions worker run.";
  if (process.platform === "win32") {
    const lines = [
      "Queued for GitHub Actions worker. Windows local auto-worker is disabled because OpenGame requires a Linux-compatible runtime.",
    ];

    if (!process.env.GITHUB_DISPATCH_TOKEN) {
      lines.push("- GITHUB_DISPATCH_TOKEN is missing, so this local app cannot immediately dispatch a GitHub Actions run.");
    }

    if (!githubDispatchRepoFromEnv()) {
      lines.push("- GITHUB_DISPATCH_REPO is missing, so the target workflow repository is not configured.");
    }

    if (process.env.FORCE_GITHUB_DISPATCH !== "1") {
      lines.push("- FORCE_GITHUB_DISPATCH=1 is not enabled, so local generation is only waiting for an external GitHub worker to claim the job.");
    }

    if (!process.env.APP_BASE_URL?.trim()) {
      lines.push("- APP_BASE_URL is missing; local callback URLs and worker diagnostics may be incomplete.");
    }

    lines.push("- To continue quickly, configure GitHub dispatch env vars or run a Linux-compatible worker.");
    return lines.join("\n");
  }
  return "Queued locally. A local GitHub-compatible worker is starting automatically and will claim this job.";
}

function queuedJobBlocker(job: { status: string; createdAt: Date; log?: string | null }) {
  if (job.status !== "QUEUED") return null;

  const queuedForMs = Date.now() - job.createdAt.getTime();
  if (queuedForMs < 15_000) return null;

  const log = job.log ?? "";
  if (/Windows local auto-worker is disabled/i.test(log)) {
    return {
      kind: "worker_unavailable",
      title: "当前没有可用生成 worker",
      body:
        "这个任务还没真正开始生成。当前运行环境是 Windows，本地 auto-worker 已禁用；同时 GitHub Actions 的即时 dispatch 配置也没有生效，所以任务会一直停在排队中，直到有外部 Linux worker 来认领。",
      actions: [
        "继续等待外部 worker",
        "返回工作台调整需求或稍后重试",
        "展开日志查看缺失配置项",
      ],
    };
  }

  if (/workflow dispatch failed/i.test(log)) {
    return {
      kind: "dispatch_failed",
      title: "GitHub Actions 触发失败",
      body: "任务已进入排队，但即时触发 GitHub Actions workflow 失败了。当前只能等待 scheduled worker，或修复 dispatch 配置后重新发起生成。",
      actions: ["继续等待 scheduled worker", "展开日志查看 dispatch 错误", "返回工作台后重试"],
    };
  }

  return null;
}

function shouldDispatchGithubWorkflow() {
  return Boolean(process.env.VERCEL || process.env.GITHUB_ACTIONS || process.env.FORCE_GITHUB_DISPATCH === "1");
}

function shouldAutoStartLocalGithubWorker() {
  if (process.platform === "win32") return false;
  return !process.env.VERCEL && !process.env.GITHUB_ACTIONS && process.env.DISABLE_LOCAL_GITHUB_WORKER !== "1";
}

function localWorkerBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function localWorkerCommand(jobId: string) {
  if (process.platform === "win32") {
    return {
      cmd: process.execPath,
      args: [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/run-github-opengame-job.ts", jobId],
    };
  }

  return {
    cmd: path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["scripts/run-github-opengame-job.ts", jobId],
  };
}

function startLocalGithubWorker(jobId: string) {
  if (localGithubWorkerJobs.has(jobId)) return false;
  localGithubWorkerJobs.add(jobId);

  const command = localWorkerCommand(jobId);
  const child = spawn(command.cmd, command.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_BASE_URL: localWorkerBaseUrl(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk).trimEnd();
    if (text) console.log(`[local-github-worker:${jobId}] ${text}`);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trimEnd();
    if (text) console.error(`[local-github-worker:${jobId}] ${text}`);
  });
  child.once("error", (error) => {
    localGithubWorkerJobs.delete(jobId);
    console.error(`[local-github-worker:${jobId}] failed to start`, error);
  });
  child.once("exit", (code) => {
    localGithubWorkerJobs.delete(jobId);
    console.log(`[local-github-worker:${jobId}] exited with code ${code ?? 0}`);
  });
  child.unref();
  return true;
}

async function updateJobProgress(jobId: string, nextProgress: number) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { progress: true } });
  if (!job) return nextProgress;
  const progress = mergeProgress(job.progress, nextProgress);
  if (progress !== job.progress) {
    await prisma.job.update({ where: { id: jobId }, data: { progress } });
  }
  return progress;
}

function encodeSandboxId(provider: SandboxProvider, sandboxId: string) {
  return `${provider}:${sandboxId}`;
}

function decodeSandboxId(value: string): { provider: SandboxProvider; sandboxId: string } {
  const [provider, ...rest] = value.split(":");
  if (provider === "github" || provider === "e2b" || provider === "vercel") {
    return { provider, sandboxId: rest.join(":") };
  }

  return { provider: "vercel", sandboxId: value };
}

async function loadSandboxSdk() {
  const mod = await import("@vercel/sandbox");
  return (mod as unknown as { Sandbox: unknown }).Sandbox as {
    create: (input?: unknown) => Promise<SandboxHandle>;
    get: (input: { sandboxId: string }) => Promise<SandboxHandle>;
  };
}

function commandInputToShell(input: unknown) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";

  const command = input as CommandInput;
  const cmd = typeof command.cmd === "string" ? command.cmd : "";
  const args = Array.isArray(command.args) ? command.args.map((arg) => String(arg)) : [];
  return [cmd, ...args].filter(Boolean).map(shellQuote).join(" ");
}

function commandEnv(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const env = (input as CommandInput).env;
  if (!env || typeof env !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(env as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, value]),
  );
}

function commandDetached(input: unknown) {
  return Boolean(input && typeof input === "object" && (input as CommandInput).detached);
}

function arrayBufferFromBuffer(buffer: Buffer) {
  return new Uint8Array(buffer).buffer;
}

async function loadE2BSandboxSdk() {
  const mod = await import("e2b");
  return (mod as unknown as { Sandbox: unknown }).Sandbox as {
    create: (templateOrOpts?: unknown, opts?: unknown) => Promise<unknown>;
    connect: (sandboxId: string, opts?: unknown) => Promise<unknown>;
  };
}

function normalizeE2BCommandError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const data = error as Record<string, unknown>;
  const exitCode = data.exitCode;
  const stdout = data.stdout;
  const stderr = data.stderr;

  if (typeof exitCode !== "number") return null;
  return {
    exitCode,
    stdout: typeof stdout === "string" ? stdout : "",
    stderr: typeof stderr === "string" ? stderr : error instanceof Error ? error.message : "",
    error: typeof data.error === "string" ? data.error : error instanceof Error ? error.message : undefined,
  };
}

function wrapE2BSandbox(sandbox: unknown): SandboxHandle {
  const e2bSandbox = sandbox as {
    sandboxId: string;
    commands: {
      run: (cmd: string, opts?: unknown) => Promise<unknown>;
    };
    files: {
      read: (path: string, opts?: unknown) => Promise<unknown>;
      write: (files: Array<{ path: string; data: ArrayBuffer }>, opts?: unknown) => Promise<unknown>;
    };
    kill: () => Promise<unknown>;
  };

  return {
    sandboxId: encodeSandboxId("e2b", e2bSandbox.sandboxId),
    async runCommand(input: unknown) {
      const background = commandDetached(input);
      const command = commandInputToShell(input);
      const envs = commandEnv(input);

      try {
        const result = (await e2bSandbox.commands.run(command, {
          background,
          ...(envs ? { envs } : {}),
          timeoutMs: background ? MAX_JOB_MS : 10 * 60 * 1000,
          requestTimeoutMs: 60_000,
        })) as { disconnect?: () => Promise<void> };

        if (background) {
          await result.disconnect?.();
        }

        return result;
      } catch (error) {
        const normalized = normalizeE2BCommandError(error);
        if (normalized) return normalized;
        throw error;
      }
    },
    async readFile(file) {
      const path = typeof file === "string" ? file : file.path;
      return e2bSandbox.files.read(path, { format: "bytes", requestTimeoutMs: 60_000 }) as Promise<Uint8Array>;
    },
    async writeFiles(files) {
      await e2bSandbox.files.write(
        files.map((file) => ({
          path: file.path,
          data: arrayBufferFromBuffer(file.content),
        })),
        { requestTimeoutMs: 60_000 },
      );
    },
    async stop() {
      await e2bSandbox.kill();
    },
  };
}

function wrapVercelSandbox(sandbox: SandboxHandle): SandboxHandle {
  return {
    sandboxId: sandbox.sandboxId ? encodeSandboxId("vercel", sandbox.sandboxId) : undefined,
    runCommand: (input) => sandbox.runCommand(input),
    readFile: sandbox.readFile ? (file) => sandbox.readFile!(file) : undefined,
    writeFiles: sandbox.writeFiles ? (files) => sandbox.writeFiles!(files) : undefined,
    stop: sandbox.stop ? () => sandbox.stop!() : undefined,
  };
}

async function createE2BSandbox() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("Missing E2B_API_KEY.");
  }

  const Sandbox = await loadE2BSandboxSdk();
  const template = process.env.E2B_TEMPLATE_ID?.trim();
  const opts = {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: MAX_JOB_MS,
    metadata: { app: "opengame-studio" },
  };
  const sandbox = template ? await Sandbox.create(template, opts) : await Sandbox.create(opts);
  return wrapE2BSandbox(sandbox);
}

async function connectE2BSandbox(sandboxId: string) {
  if (!process.env.E2B_API_KEY) {
    throw new Error("Missing E2B_API_KEY.");
  }

  const Sandbox = await loadE2BSandboxSdk();
  return wrapE2BSandbox(
    await Sandbox.connect(sandboxId, {
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: MAX_JOB_MS,
    }),
  );
}

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

type GameplayBlueprint = {
  archetype: string;
  loop: string;
  controls: string;
  state: string;
  pacing: string;
  ui: string;
};

function gameplayBlueprintForKey(key: GameplaySkeletonKey): GameplayBlueprint {
  switch (key) {
    case "breakout":
      return {
        archetype: "single-screen breakout",
        loop: "Move the paddle, bounce the ball, break a curated block pattern, and escalate pressure with a small number of readable modifiers.",
        controls: "Keyboard left/right plus mouse fallback, with instant start on click or Space.",
        state: "Track score, lives, combo, remaining blocks, and a clear round-complete or game-over state.",
        pacing: "Fast first interaction within 2 seconds, then steady escalation through block behavior, speed, or hazards.",
        ui: "Use an arcade hero intro, a top HUD rail with panelized stats, and a polished restart/result overlay.",
      };
    case "runner":
      return {
        archetype: "lane or endless runner",
        loop: "Keep moving forward, dodge obstacles, collect pickups, and survive or reach a target score.",
        controls: "Arrow keys or swipe-like keyboard mapping with one clear dodge/jump action.",
        state: "Track score, speed, distance, streak, and remaining health or mistakes.",
        pacing: "Open with a short countdown, then ramp lane density and obstacle rhythm in clean beats.",
        ui: "Use a cinematic start card, floating in-run HUD chips, and an end screen with score breakdown and replay CTA.",
      };
    case "shooter":
      return {
        archetype: "single-screen shooter",
        loop: "Move, shoot, dodge enemy patterns, and survive waves or defeat a mini boss.",
        controls: "WASD or arrow movement with Space or click shooting and an instant ready state.",
        state: "Track score, health, wave, weapon cooldown, and a strong hit or defeat feedback loop.",
        pacing: "Start with one readable enemy pattern, then layer a second hazard instead of increasing chaos too early.",
        ui: "Use a bold hero splash, top-corner HUD modules, damage feedback, and a designed victory or defeat overlay.",
      };
    case "defense":
      return {
        archetype: "compact tower defense",
        loop: "Place or trigger a small set of defenses, manage limited resources, and stop enemies reaching the goal.",
        controls: "Mouse-first placement with keyboard shortcuts optional and immediate visual placement feedback.",
        state: "Track coins, wave, base health, tower state, and a clear between-wave or game-over transition.",
        pacing: "Keep the map compact, resource economy simple, and waves readable with 1-2 enemy types at a time.",
        ui: "Use a planning-oriented start panel, panelized shop/HUD modules, and a result card with retry and upgrade prompts.",
      };
    case "puzzle":
      return {
        archetype: "single-screen puzzle loop",
        loop: "Present one readable puzzle goal, let the player act quickly, and provide satisfying completion or failure feedback.",
        controls: "Mouse or keyboard controls with explicit affordances, hinting, and restart access.",
        state: "Track moves, timer or efficiency, objective progress, and solved or failed outcomes.",
        pacing: "Teach the mechanic in the first interaction, then reveal one extra twist without overwhelming the player.",
        ui: "Use a clean puzzle hero card, compact top HUD panels, and a celebratory completion overlay with replay CTA.",
      };
    case "collector":
      return {
        archetype: "top-down collect and avoid",
        loop: "Move through a bounded arena, collect targets, avoid hazards, and bank score before time or health runs out.",
        controls: "WASD or arrow movement with simple context action on click or Space when needed.",
        state: "Track score, timer, inventory or pickup count, and health or mistake budget.",
        pacing: "Begin with immediate movement and collection, then add one hazard pattern and one risk-reward pickup.",
        ui: "Use a glossy intro panel, readable arena HUD chips, pickup feedback, and a strong end-of-run summary.",
      };
    default:
      return {
        archetype: "single-screen arcade action",
        loop: "Give the player one clear repeatable action, one threat to respond to, and one score or progress goal to chase.",
        controls: "Support click-to-start plus obvious keyboard controls with low friction onboarding.",
        state: "Track score, progress, remaining chances, and an explicit victory or failure state.",
        pacing: "Get to gameplay quickly, keep the mechanic count low, and escalate with one polished variation at a time.",
        ui: "Use a premium landing-style start screen, a compact but readable HUD, and a polished result overlay with replay CTA.",
      };
  }
}

function inferGameplayBlueprint(prompt: string, skeletonKey?: GameplaySkeletonKey): GameplayBlueprint {
  const normalizedSkeletonKey = normalizeGameplaySkeletonKey(skeletonKey);
  const resolvedSkeletonKey = normalizedSkeletonKey === "auto" ? inferGameplaySkeletonKey(prompt) : normalizedSkeletonKey;

  if (resolvedSkeletonKey !== "auto") {
    return gameplayBlueprintForKey(resolvedSkeletonKey);
  }

  return gameplayBlueprintForKey("auto");
}

function buildGameplayBlueprintSection(prompt: string, skeletonKey?: GameplaySkeletonKey) {
  const normalizedSkeletonKey = normalizeGameplaySkeletonKey(skeletonKey);
  const resolvedSkeletonKey = normalizedSkeletonKey === "auto" ? inferGameplaySkeletonKey(prompt) : normalizedSkeletonKey;
  const blueprint = inferGameplayBlueprint(prompt, normalizedSkeletonKey);

  const skeletonLine =
    normalizedSkeletonKey === "auto"
      ? `- Gameplay skeleton: auto-match from the brief${resolvedSkeletonKey !== "auto" ? `, inferred as ${resolvedSkeletonKey}` : ""}.`
      : `- Gameplay skeleton: explicitly use the ${resolvedSkeletonKey} archetype.`;

  return [
    "Recommended gameplay skeleton:",
    skeletonLine,
    `- Archetype: ${blueprint.archetype}.`,
    `- Core loop: ${blueprint.loop}`,
    `- Controls: ${blueprint.controls}`,
    `- State model: ${blueprint.state}`,
    `- Pacing: ${blueprint.pacing}`,
    `- UI framing: ${blueprint.ui}`,
  ];
}

function isWebReadable(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && "getReader" in value;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

async function streamToBuffer(value: unknown) {
  if (!value) return Buffer.alloc(0);
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);

  if (isWebReadable(value)) {
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (chunk) chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  if (isAsyncIterable(value)) {
    const chunks: Buffer[] = [];
    for await (const chunk of value) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported sandbox file stream.");
}

async function streamToString(value: unknown) {
  const buffer = await streamToBuffer(value);
  return buffer.toString("utf8");
}

async function sandboxReadFile(sandbox: SandboxHandle, path: string) {
  if (sandbox.readFile) {
    try {
      return sandbox.readFile({ path });
    } catch {
      return sandbox.readFile(path);
    }
  }

  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `test -f ${shellQuote(path)} && cat ${shellQuote(path)} || true`],
  });

  return commandStdout(result);
}

async function sandboxWriteFiles(
  sandbox: SandboxHandle,
  files: Array<{ path: string; content: string }>,
) {
  const normalized = files.map((file) => ({
    path: file.path,
    content: Buffer.from(file.content),
  }));

  if (sandbox.writeFiles) {
    await sandbox.writeFiles(normalized);
    return;
  }

  for (const file of normalized) {
    const encoded = file.content.toString("base64");
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        `mkdir -p "$(dirname ${shellQuote(file.path)})" && printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(file.path)}`,
      ],
    });
  }
}

async function commandStdout(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";

  if ("stdout" in result && typeof result.stdout === "string") return result.stdout;
  if ("stdout" in result && typeof result.stdout === "function") {
    return (await (result.stdout as () => Promise<string>)()) ?? "";
  }
  if ("output" in result && typeof result.output === "function") {
    return (await (result.output as (stream?: "stdout" | "stderr" | "both") => Promise<string>)(
      "stdout",
    )) ?? "";
  }

  return "";
}

export function buildOpenGameScript() {
  const opengameGitUrl = process.env.OPENGAME_GIT_URL?.trim() || "https://github.com/leigest519/OpenGame.git";

  return `#!/usr/bin/env bash
set +e

WORKSPACE_ROOT=${shellQuote(WORKSPACE_ROOT)}
OPENGAME_ROOT=${shellQuote(OPENGAME_ROOT)}
GENERATED_DIR=${shellQuote(GENERATED_DIR)}
PROMPT_FILE="$WORKSPACE_ROOT/prompt.txt"
PROGRESS_LOG=${shellQuote(PROGRESS_LOG)}
ERROR_LOG=${shellQuote(ERROR_LOG)}
PHASE_FILE=${shellQuote(PHASE_FILE)}
VALIDATION_LOG=${shellQuote(VALIDATION_LOG)}
VALIDATION_REPORT=${shellQuote(VALIDATION_REPORT)}
PLAYABLE_MARKER=${shellQuote(PLAYABLE_MARKER)}
VALIDATOR_SCRIPT=${shellQuote(VALIDATOR_SCRIPT)}
OPENGAME_GIT_URL=${shellQuote(opengameGitUrl)}
MAX_REPAIR_ATTEMPTS=${MAX_REPAIR_ATTEMPTS}

set_phase() {
  printf "%s" "$1" > "$PHASE_FILE"
}

log_visual_director() {
  echo "[quality][visual-director] Applying premium generation contract: coherent gameplay archetype, authored theme, compact responsive framing, and Astrocade-grade presentation."
  echo "[quality][visual-director] Required UI layers: background, playfield, actors/targets, HUD, feedback, and result overlay."
  echo "[quality][visual-director] Required polish signals: unified palette, rounded panels, shadows/glow, tactile motion, start cover, multi-module HUD, and replay-ready result card."
  echo "[quality][mobile] Must fit 390x844 phone portrait and 960x640 desktop landscape without clipped HUD, controls, or gameplay targets."
}

log_validation_summary() {
  if [ ! -s "$VALIDATION_REPORT" ]; then
    echo "[quality][validation] No validation report was produced."
    return
  fi

  node - "$VALIDATION_REPORT" <<'NODE'
const fs = require("fs");
const reportPath = process.argv[2];
let report = {};
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  console.log("[quality][validation] Failed to parse validation report: " + error.message);
  process.exit(0);
}
const reasons = Array.isArray(report.reasons) ? report.reasons : report.reason ? [report.reason] : [];
const metrics = report.metrics || {};
console.log("[quality][validation] ok=" + Boolean(report.ok) + " reasons=" + reasons.length);
for (const reason of reasons.slice(0, 8)) console.log("[quality][validation][reason] " + reason);
if (Object.keys(metrics).length) {
  const summary = {
    colors: metrics.colors,
    gradients: metrics.gradients,
    radii: metrics.radii,
    shadows: metrics.shadows,
    visibleElementCount: metrics.visibleElementCount,
    defaultControls: metrics.defaultControls,
    hudSignals: metrics.hudSignals,
    endSignals: metrics.endSignals,
    feedbackSignals: metrics.feedbackSignals,
  };
  console.log("[quality][validation][metrics] " + JSON.stringify(summary));
}
NODE
}

ensure_tools() {
  local missing_core=""
  for tool in git node npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing_core="$missing_core $tool"
    fi
  done

  if [ -n "$missing_core" ]; then
    echo "[setup] Installing sandbox system tools..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update || return $?
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git nodejs npm curl ca-certificates || return $?
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y git nodejs npm curl-minimal || return $?
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y git nodejs npm curl || return $?
    else
      echo "[setup] No supported package manager found for missing tools:$missing_core" >&2
      return 1
    fi
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "[setup] curl is still unavailable after installing core tools." >&2
    return 1
  fi

  if command -v chromium >/dev/null 2>&1; then
    export CHROME_BIN="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    export CHROME_BIN="$(command -v chromium-browser)"
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    export CHROME_BIN="$(command -v google-chrome-stable)"
  elif [ -d "$WORKSPACE_ROOT/browser-runtime/node_modules/playwright-chromium" ]; then
    export PLAYWRIGHT_BROWSERS_PATH=0
    export CHROME_BIN="$(cd "$WORKSPACE_ROOT/browser-runtime" && node -e "const { chromium } = require('playwright-chromium'); console.log(chromium.executablePath())")"
  else
    echo "[setup] Installing Playwright Chromium for playable validation..."
    mkdir -p "$WORKSPACE_ROOT/browser-runtime" || return $?
    cd "$WORKSPACE_ROOT/browser-runtime" || return $?
    if [ ! -f package.json ]; then
      npm init -y >/dev/null 2>&1 || return $?
    fi
	    export PLAYWRIGHT_BROWSERS_PATH=0
	    npm install --no-save playwright-chromium@1.49.1 || return $?
	    npx playwright install-deps chromium >/dev/null 2>&1 || true
	    export CHROME_BIN="$(node -e "const { chromium } = require('playwright-chromium'); console.log(chromium.executablePath())")"
	  fi

  if [ ! -x "$CHROME_BIN" ]; then
    echo "[setup] Browser executable was not found at $CHROME_BIN." >&2
    return 1
  fi
}

ensure_opengame() {
  if [ ! -f "$OPENGAME_ROOT/dist/cli.js" ] && [ ! -x "$OPENGAME_ROOT/bin/opengame" ]; then
    echo "[setup] Installing OpenGame from $OPENGAME_GIT_URL..."
    rm -rf "$OPENGAME_ROOT"
    git clone --depth 1 "$OPENGAME_GIT_URL" "$OPENGAME_ROOT" || return $?
    cd "$OPENGAME_ROOT" || return $?
    npm install || return $?
    npm run build || return $?
  fi

  if [ -f "$OPENGAME_ROOT/dist/cli.js" ]; then
    OPENGAME_BIN="$OPENGAME_ROOT/dist/cli.js"
    OPENGAME_MODE="node"
  elif [ -x "$OPENGAME_ROOT/bin/opengame" ]; then
    OPENGAME_BIN="$OPENGAME_ROOT/bin/opengame"
    OPENGAME_MODE="bin"
  else
    echo "[setup] OpenGame CLI was not found after setup." >&2
    return 127
  fi

  if [ "$OPENGAME_MODE" = "node" ]; then
    HELP_OUTPUT="$(node "$OPENGAME_BIN" --help 2>&1)"
  else
    HELP_OUTPUT="$("$OPENGAME_BIN" --help 2>&1)"
  fi
}

restore_source() {
  if [ -n "$OPENGAME_SOURCE_URL" ]; then
    echo "[source] Restoring previous source archive..."
    rm -rf "$GENERATED_DIR"
    mkdir -p "$GENERATED_DIR"
    curl -fsSL "$OPENGAME_SOURCE_URL" -o "$WORKSPACE_ROOT/source.zip" || return $?
    unzip -oq "$WORKSPACE_ROOT/source.zip" -d "$GENERATED_DIR" || return $?
  fi
}

run_opengame() {
  local continue_requested="$1"
  local prompt
  prompt="$(cat "$PROMPT_FILE")"
  cd "$GENERATED_DIR" || return $?

  if [ "$continue_requested" = "1" ] && printf "%s" "$HELP_OUTPUT" | grep -q -- "--continue"; then
    echo "[opengame] Running continue pass in $GENERATED_DIR"
    echo "[quality][repair] Continue mode keeps existing source while enforcing quality and playability fixes."
    if [ "$OPENGAME_MODE" = "node" ]; then
      node "$OPENGAME_BIN" --continue -p "$prompt" --yolo
    else
      "$OPENGAME_BIN" --continue -p "$prompt" --yolo
    fi
  else
    echo "[opengame] Starting generation in $GENERATED_DIR"
    log_visual_director
    if [ "$OPENGAME_MODE" = "node" ]; then
      node "$OPENGAME_BIN" -p "$prompt" --yolo
    else
      "$OPENGAME_BIN" -p "$prompt" --yolo
    fi
  fi
}

normalize_index() {
  cd "$GENERATED_DIR" || return $?
  if [ ! -f index.html ]; then
    first_html="$(find . -maxdepth 1 -type f -name '*.html' | head -n 1)"
    if [ -n "$first_html" ]; then
      cp "$first_html" index.html || return $?
      echo "[publish] Normalized $first_html to index.html"
    fi
  fi

  test -s index.html
}

write_missing_index_report() {
  cat > "$VALIDATION_REPORT" <<'JSON'
{
  "ok": false,
  "reason": "OpenGame finished without a non-empty index.html."
}
JSON
}

validate_playable() {
  set_phase "VALIDATING"
  echo "[validation] Opening generated game in headless Chromium..."
  node "$VALIDATOR_SCRIPT" "$GENERATED_DIR" "$VALIDATION_REPORT" >> "$PROGRESS_LOG" 2>> "$VALIDATION_LOG"
  local validation_status="$?"
  log_validation_summary
  return "$validation_status"
}

write_repair_prompt() {
  local attempt="$1"
  local report
  report="$(cat "$VALIDATION_REPORT" 2>/dev/null)"
  echo "[quality][repair] Building repair prompt for attempt $attempt/$MAX_REPAIR_ATTEMPTS from validation report."
  log_validation_summary
  {
    echo "Repair this existing HTML5 game so it is actually playable."
    echo
    echo "Original user request and delivery contract:"
    cat "$WORKSPACE_ROOT/original-prompt.txt"
    echo
    echo "Playable validation failed on attempt $attempt. Validation report:"
    printf "%s\\n" "$report"
    echo
    echo "Fix the root cause in the existing files. Hard requirements:"
    echo "- The first visible start/play button or centered start area must respond to a click."
    echo "- Keyboard input with arrows, WASD, and Space must affect gameplay when relevant."
    echo "- Avoid full-screen overlays that keep intercepting clicks after the game starts."
    echo "- Keep a non-empty index.html as the playable entry."
    echo "- Do not remove the user's theme; simplify mechanics if needed to make the game playable."
    echo "- Fix gameplay coherence failures: rules shown in the UI must match actual interactions, the win condition must be achievable, restart/retry must work, and level/puzzle layouts must not be deadlocked or impossible."
    echo "- Expose window.__OPENGAME_DEBUG__ with inputCoverage and solvability fields such as totalLevels, solvable, allLevelsSolvable, levelPlans, activeTargets, and playfield."
    echo "- Preserve the visual quality contract; do not replace designed backgrounds, HUD, characters, or effects with bare placeholders while repairing mechanics."
    echo "- Preserve and improve premium UI polish: consistent palette, layered background, authored HUD modules, tactile feedback, motion accents, start cover screen, and result overlay."
    echo "- Keep mobile composition intact: on 390x844 the playfield, HUD, primary action, and result/retry controls must all remain visible and reachable."
    echo "- Do not create or run Playwright, Puppeteer, Selenium, npm test, or browser-install test suites; the platform performs validation after generation."
    echo "- Focus only on fixing the self-contained playable index.html quickly."
    echo "- Do not spend tokens narrating plans, checklists, or self-tests. Modify the playable files directly and finish quickly."
    echo "- Rebuild toward an Astrocade-grade result: one clean gameplay archetype, one coherent visual system, one polished interaction loop."
    echo "- Also fix visual quality failures: keep the game non-pixel-art, remove 8-bit/blocky/pixelated styling, replace default/plain UI with polished modern panels, gradients, rounded controls, shadows/glow, animated background accents, a clear multi-module HUD, a designed hero/start screen, and a replay-ready end-state screen."
    echo "- The next version must look curated before interaction: strong title treatment, concise hook text, branded CTA, and a framed playfield."
    echo "- The next version must expose at least two readable state modules such as score, lives, time, combo, wave, level, goal, or progress."
    echo "- The next version must include a visible result overlay or win/lose card with replay CTA instead of plain text."
  } > "$PROMPT_FILE"
}

main() {
  rm -f ${shellQuote(EXIT_CODE_FILE)} "$PLAYABLE_MARKER"
  mkdir -p "$GENERATED_DIR"
  : > "$PROGRESS_LOG"
  : > "$ERROR_LOG"
  : > "$VALIDATION_LOG"
  set_phase "RUNNING"
  cp "$PROMPT_FILE" "$WORKSPACE_ROOT/original-prompt.txt"

  ensure_tools || return $?
  ensure_opengame || return $?
  restore_source || return $?

  attempt=0
  while [ "$attempt" -le "$MAX_REPAIR_ATTEMPTS" ]; do
    echo "[quality][attempt] Starting generation attempt $((attempt + 1))/$((MAX_REPAIR_ATTEMPTS + 1))."
    if [ "$attempt" -gt 0 ]; then
      set_phase "REPAIRING"
      echo "[repair] Attempt $attempt/$MAX_REPAIR_ATTEMPTS after playable validation failed."
      write_repair_prompt "$attempt"
    fi

    continue_requested="$OPENGAME_USE_CONTINUE"
    if [ "$attempt" -gt 0 ]; then
      continue_requested="1"
    fi

    if [ "$attempt" -gt 0 ]; then
      set_phase "REPAIRING"
    else
      set_phase "RUNNING"
    fi
    run_opengame "$continue_requested"
    status=$?

    if ! normalize_index; then
      write_missing_index_report
      echo "[publish] OpenGame finished without a non-empty index.html." >&2
    elif [ "$status" -ne 0 ]; then
      echo "[opengame] CLI exited with $status but produced index.html; validating output before deciding." >&2
    fi

    if [ -s "$GENERATED_DIR/index.html" ] && validate_playable; then
      printf "yes" > "$PLAYABLE_MARKER"
      set_phase "PLAYABLE"
      echo "[validation] Playable validation passed. Build is ready to publish."
      echo "[quality][publish-gate] Passed playability, visual polish, feedback, HUD, responsive layout, and result-state checks."
      return 0
    fi

    echo "[quality][attempt] Attempt $((attempt + 1)) failed quality/playability gate; preparing next repair if available."
    attempt=$((attempt + 1))
  done

  echo "[validation] Game failed playable validation after $MAX_REPAIR_ATTEMPTS repair attempts." >&2
  return 1
}

main >> "$PROGRESS_LOG" 2>> "$ERROR_LOG"
status=$?
printf "%s" "$status" > ${shellQuote(EXIT_CODE_FILE)}
exit "$status"
`;
}

function buildApplicationPrompt(prompt: string) {
  return [
    "Build a polished, production-ready HTML5 web application from the user's request.",
    "",
    "User application request:",
    prompt,
    "",
    "Application direction:",
    "- This is an application, not a game. Do not force win/lose rules, enemies, lives, levels, waves, or combat unless the user explicitly asks for game mechanics.",
    "- Focus on a useful interactive workflow: input, edit, filter, preview, organize, calculate, generate, compare, save locally, or present information clearly depending on the request.",
    "- The app must be self-contained in index.html unless the user provided explicit HTTPS asset URLs.",
    "- Include a polished landing/header area, a clear primary task area, helpful empty states, loading/processing feedback, validation/error feedback, and a useful result/detail state.",
    "- Design for mobile first at 390x844 and desktop at 960x640 with no clipped controls, no horizontal overflow, and all primary actions reachable.",
    "- Use a consistent design system: 3-5 colors, typography scale, spacing, radius, shadows/glow, tactile button states, card surfaces, and responsive layout.",
    "- Provide meaningful sample content only when needed to demonstrate the workflow; never pretend to call external services or use real user data.",
    "- Expose window.__OPENGAME_DEBUG__ when possible with { appState, inputCoverage, activeTargets, primaryActions, responsiveReady } so validation can inspect interactivity.",
    "- Keyboard, pointer, and touch should all have a usable path for primary actions. Forms, cards, tabs, filters, sliders, or drag areas must respond visibly.",
    "",
    "Quality bar:",
    "- The first screen should look like a finished app, not a game shell or raw prototype.",
    "- Avoid default browser UI, unstyled forms, blank backgrounds, debug text, placeholder rectangles, or inaccessible tiny controls.",
    "- The final result should feel like a shareable mini app/tool page with clear value in the first 5 seconds.",
  ].join("\n");
}

function shouldUseFullPromptContract() {
  return process.env.OPENGAME_PROMPT_PROFILE === "full";
}

function buildFastGamePrompt(prompt: string, skeletonKey?: GameplaySkeletonKey) {
  return [
    "Build a polished, playable, self-contained HTML5 game from the user's request. Write files directly, especially index.html. Do not run installs, browser tests, Playwright/Puppeteer/Selenium, npm test, smoke tests, or long self-check scripts.",
    "",
    "User creative request:",
    prompt,
    "",
    "Gameplay blueprint:",
    ...buildGameplayBlueprintSection(prompt, skeletonKey),
    "",
    "Non-negotiable playability contract:",
    "- The first visible start/play CTA must respond to click/tap and enter gameplay.",
    "- Provide keyboard arrows/WASD/Space plus pointer/touch equivalents for the core action.",
    "- Include at least 3 levels, waves, rounds, stages, or difficulty tiers. Show progress in the HUD.",
    "- Include clear rule hints, score/progress/lives/timer modules, win/lose/retry feedback, and restart.",
    "- Keep all targets, controls, HUD, exits, cards, vehicles, bullets, fruit, and result actions fully visible on 390x844 phone portrait and 960x640 desktop landscape.",
    "- Expose window.__OPENGAME_DEBUG__ with gameState, score, level/wave/round, inputCoverage, playfield, activeTargets, solvable/allLevelsSolvable/levelPlans when applicable.",
    "- For traffic jam / parking escape puzzles: smaller vehicles, larger fully visible grid, real path-clear escape rule, blocked shake cue, at least 4 vehicles in level 1, one opening move, and every level solvable.",
    "",
    "Premium UI contract:",
    "- Make it look like a finished arcade mini-game, not a prototype: designed start cover, layered background, framed playfield, compact HUD, tactile feedback, and polished result overlay.",
    "- Use a coherent palette, CSS variables/constants, rounded panels, shadows/glow, gradients, motion accents, hit/miss/blocked feedback, and responsive safe zones.",
    "- Avoid blank backgrounds, default browser buttons, plain circles/rectangles as final art, debug text, pixelated/8-bit styling unless explicitly requested.",
    "",
    "Speed instruction:",
    "- Prefer a reliable single-file implementation with programmatic art. Reduce feature count before sacrificing playability, visual completeness, or mobile fit.",
    "- Do not narrate plans. Create the playable deliverable quickly and finish.",
  ].join("\n");
}

export function buildPlayablePrompt(prompt: string, skeletonKey?: GameplaySkeletonKey, contentType: ContentTypeValue = "GAME") {
  if (normalizeContentType(contentType) === "APPLICATION") return buildApplicationPrompt(prompt);
  if (!shouldUseFullPromptContract()) return buildFastGamePrompt(prompt, skeletonKey);

  return [
    "Build a playable HTML5 game from the user's creative request.",
    "",
    "User creative request:",
    prompt,
    "",
    "Astrocade-grade product direction:",
    "- Treat this as a premium, publish-ready HTML5 mini-game, not a raw prototype.",
    "- Prefer a tightly-scoped, beautifully-presented single-screen experience over an ambitious but messy multi-system design.",
    "- Use one coherent gameplay archetype, one strong theme, and one polished interaction loop.",
    "- Act as a gameplay director and UI art director before coding: pick a camera/framing model, a color palette, a readable HUD structure, and a tactile feedback language that all match the user's theme.",
    "",
    ...buildGameplayBlueprintSection(prompt, skeletonKey),
    "",
    "Hard delivery contract:",
    "- Produce a playable HTML5 game with a non-empty index.html entry. Keep it self-contained unless the creative request provides explicit HTTPS asset URLs; those assets may be referenced directly.",
    "- Do not create, install, or run Playwright, Puppeteer, Selenium, npm test, smoke_test, test.js, or any browser-download test harness. The platform will validate playability automatically after you finish.",
    "- Keep the deliverable fast: write the game files directly, especially index.html, without running package installs or external verification scripts.",
    "- Keep the response/action concise: do not narrate long plans, checklists, or self-tests. Create the files directly and finish.",
    "- The first visible start/play button or centered start area must respond to a click.",
    "- The game must enter a core loop after start, with visible state such as score, level, lives, timer, enemies, or progress.",
    "- Keyboard input with arrows, WASD, and Space must affect gameplay. Even mouse-first games need keyboard equivalents such as move/aim/select/confirm/pause/restart.",
    "- Mouse/touch games must respond to realistic pointer gestures. If the core action is slicing, drawing, aiming, dragging, or clicking targets, automated diagonal and vertical swipes across the playfield must visibly affect gameplay.",
    "- Mobile touch must be first-class: support tap plus swipe/drag gestures on phone-sized screens, prevent page scroll during gameplay where appropriate, and keep all controls reachable by thumb.",
    "- All interactive targets, hazards, collectibles, enemies, fruits, bullets, cards, or prompts must become reachable in the active play area. Do not spawn them only at the bottom edge, behind HUD, outside the viewport, or in positions that are impossible to click/slice/reach.",
    "- Moving targets must travel through the upper, middle, and lower portions of the framed playfield with enough dwell time for a human player to react.",
    "- Include real progression: at least 3 levels, waves, rounds, stages, rooms, puzzles, or difficulty tiers. Do not end after one wave, one obstacle, one card, or one short interaction.",
    "- Show progression in the HUD or overlay with labels such as Level/Wave/Round/Stage/目标进度, and advance it during play.",
    "- Include clear failure, win, score, or restart feedback; simplify the mechanics if needed to make it reliable.",
    "- Do not leave a modal, overlay, or intro screen permanently intercepting player input after start.",
    "- Expose a lightweight window.__OPENGAME_DEBUG__ hook for validation. It should return { gameState, score, lives, level, wave, round, maxLevel, maxWave, totalLevels, inputCoverage, playfield, activeTargets, solvable, allLevelsSolvable, levelPlans }, where inputCoverage marks keyboard/pointer/touch support and levelPlans marks each designed level as solvable when applicable.",
    "- Gameplay must be self-explanatory inside the game UI: show a concise rule card or first-level hint that says what to click/tap, what is blocked, what counts as success, and how to restart. Do not rely on the gallery description to explain the rules.",
    "- The game rules must be internally coherent: every action described in the UI must work, the win condition must be achievable, restart/retry must be available, and no generated level may start in a deadlock or unwinnable state.",
    "- For traffic jam, parking escape, unblock-car, or vehicle-grid puzzle games, implement the real escape rule: multiple vehicles occupy lanes and can block one another; tapping/clicking a vehicle only lets it drive away if every cell/path ahead of its facing direction is clear until the exit edge; blocked vehicles should shake or show a 'blocked' cue instead of moving; the player wins only after all vehicles have escaped. Include at least 3 increasingly crowded layouts.",
    "- Vehicle-grid puzzle quality gate: use smaller vehicles if needed and a larger visible map/playfield, but the full grid, all exits, all vehicles, and the HUD must fit inside the visible play area on desktop and phone screens without clipping. Level 1 must contain at least 4 vehicles, at least one immediately movable vehicle, and a clearly solvable sequence. Every later level must also be solvable by design; do not create deadlocked starting layouts where all vehicles are blocked.",
    "",
    "Baseline visual quality contract:",
    "- Treat visual design as part of the playable deliverable, not decoration added after the mechanics.",
    "- Unless the user explicitly asks for another style, aim for a polished futuristic arcade look: layered sci-fi background, luminous color accents, crisp silhouettes, subtle bloom, particles, trails, and a compact holographic HUD.",
    "- If the user's theme is not sci-fi, keep the requested theme but still apply the same level of polish: designed background, readable composition, cohesive palette, styled UI, and animated feedback.",
    "- Do not ship a prototype-looking game: avoid blank white or gray backgrounds, plain circles/rectangles as final characters, default browser buttons, unstyled text, and collisions with no visible effect.",
    "- Create programmatic art when image assets are unavailable: Canvas/CSS gradients, parallax layers, starfields or texture patterns, shaped characters, enemy silhouettes, collectible icons, projectile effects, hit flashes, and score/life panels.",
    "- The first screen, active play scene, win/lose state, restart affordance, and HUD should all feel like the same designed game world.",
    "- Every generated game needs a clear visual hierarchy: background layer, playfield layer, actors/targets layer, HUD layer, feedback layer, and modal/result layer. These layers must not fight for attention.",
    "- Use a small design system: CSS variables or constants for palette, type scale, spacing, radius, shadows/glow, motion duration, and z-index. Reuse it instead of one-off styles.",
    "- Make interactive elements tactile: hover/press states, tap feedback, hit flashes, blocked shakes, score popups, transition easing, and short celebratory effects for success.",
    "",
    "Presentation shell contract:",
    "- Start screen: include a designed hero section with game title, a short one-line hook, a clear start CTA, and visible theme framing before gameplay begins.",
    "- Gameplay HUD: include at least 2 readable status modules such as score, lives, time, level, combo, wave, ammo, or target progress.",
    "- End state: include a designed win/lose/restart overlay or result card with a clear replay CTA and concise performance summary.",
    "- Layout: use layered background, framed playfield, spacing rhythm, and a clear content hierarchy so the game looks like a finished product page, not a blank canvas.",
    "- Keep the full playable scene inside the visible viewport: the start CTA, main playfield, HUD, and restart/result actions must remain fully visible without browser zoom, clipped edges, or off-screen controls.",
    "- Reserve a true play-safe zone separate from HUD and overlays. Gameplay objects must not be hidden under decorative chrome, mobile browser edges, or fixed panels.",
    "- Build responsive layout from the start, not as an afterthought: support at least 390x844 phone portrait and 960x640 desktop landscape with no horizontal overflow, no clipped critical controls, and no unreachable gameplay targets.",
    "- Keep the game camera/framed playfield centered and fully visible. If letterboxing is needed, use designed background fill, but never crop the actual game board or hide vehicles, cards, enemies, fruit, bullets, buttons, exits, or HUD.",
    "- Prioritize a complete, playable core loop over visual ambition. If a mechanic risks deadlock, unclear rules, invisible targets, unresponsive input, or offscreen content, simplify it before finalizing.",
    "- Add an in-game 'how to play' hint on the first level or start screen. It must explain the core click/tap/drag rule, the win condition, and what feedback means when an action is blocked or invalid.",
    "- Mobile composition is a first-class design target: on 390x844, the title/HUD should be compact, the main playfield should get most of the height, primary actions should sit in a thumb-safe area, and no important content may hide below the fold.",
    "",
    "Premium UI polish rubric:",
    "- Start screen must feel like a real game cover: title treatment, one-line hook, visual motif, primary CTA, and at least one animated or layered decorative element.",
    "- HUD must be compact but expressive: use icons/badges/cards for score, level, lives, target, timer, or combo; avoid plain unstyled text rows.",
    "- Gameplay scene must have authored visual identity: styled player/target/obstacle shapes, themed background, depth or parallax, and feedback for every important state change.",
    "- End/result screen must include outcome, performance summary, next/retry CTA, and a polished card or overlay, not just alert() or bare text.",
    "- If a requested genre is puzzle, sports, racing, shooting, slicing, platforming, or matching, use genre-appropriate feedback conventions such as trajectory guides, lane markers, impact particles, combo labels, route highlights, blocked cues, or target reticles.",
    "",
    "Level design contract:",
    "- Design at least 3 playable stages. Examples: 3 waves of enemies, 5 timed rounds, 3 puzzle rooms, escalating speed tiers, route checkpoints, or progressive objectives.",
    "- Each stage should introduce a small readable change such as speed, target count, pattern, obstacle layout, scoring goal, timer pressure, or enemy behavior.",
    "- For puzzle or level-based games, predefine each level so it has at least one valid opening move and a clear path to completion. If the design cannot guarantee solvability, simplify the level until it can.",
    "- Do not mark the game complete after the first success. After one stage ends, advance to the next stage until the final win/lose result.",
    "",
    "Visual quality contract:",
    "- Default to a polished non-pixel-art visual direction. Do not create 8-bit, pixel art, blocky sprites, low-resolution scaled canvases, or image-rendering: pixelated/crisp-edges styles unless the user explicitly asks for pixel art.",
    "- Use a modern, publish-ready UI: designed start screen, game HUD, score/status panels, restart/end-state screen, clear typography, spacing, and responsive layout.",
    "- If the game uses a fixed logical resolution, implement fit-to-screen scaling or letterboxing so the entire game surface remains visible across desktop and mobile sizes.",
    "- Add visual depth with gradients, rounded panels/buttons, soft shadows/glow, layered backgrounds, particles or motion accents, and smooth transitions where appropriate.",
    "- Avoid default browser UI, plain unstyled buttons, blank solid backgrounds, placeholder rectangles, debug text, or minimal wireframe layouts.",
    "- If the requested theme is retro, interpret it as modern neon/arcade unless the user explicitly says pixel art.",
    "- Use a consistent design system: 3-5 theme colors, one strong accent, panel surfaces, branded button styling, and repeatable spacing/radius/shadow tokens.",
    "- Make the first screen screenshot-worthy. The game should look curated even before the player clicks start.",
    "",
    "Implementation strategy contract:",
    "- Build a small internal design system with CSS variables for colors, spacing, radius, shadow, and typography, then reuse it across start screen, HUD, overlays, and buttons.",
    "- Keep code organized and reliable; remove risky mechanics if they threaten polish or playability.",
    "- Favor readable motion, impact feedback, and responsive resizing over extra feature count.",
  ].join("\n");
}

async function createVercelSandboxFromSnapshot() {
  const snapshotId = process.env.OPENGAME_SNAPSHOT_ID;
  const Sandbox = await loadSandboxSdk();

  if (snapshotId) {
    try {
      const sandbox = await Sandbox.create({
        ...sandboxCredentialsFromEnv(),
        timeout: MAX_JOB_MS,
        resources: { vcpus: 2 },
        source: { type: "snapshot", snapshotId },
      });
      return wrapVercelSandbox(sandbox);
    } catch (error) {
      if (isSandboxUnrecoverableProvisioningError(error)) throw error;
      console.warn("Failed to create Sandbox from OPENGAME_SNAPSHOT_ID; falling back to cold setup.", error);
    }
  }

  const sandbox = await Sandbox.create({
    ...sandboxCredentialsFromEnv(),
    runtime: "node22",
    timeout: MAX_JOB_MS,
    resources: { vcpus: 2 },
  });
  return wrapVercelSandbox(sandbox);
}

export async function createSandboxFromSnapshot() {
  if (sandboxProviderFromEnv() === "vercel") {
    return createVercelSandboxFromSnapshot();
  }

  if (sandboxProviderFromEnv() === "github") {
    throw new Error("GitHub Actions provider does not create an interactive sandbox.");
  }

  return createE2BSandbox();
}

export async function getSandbox(sandboxId: string) {
  const decoded = decodeSandboxId(sandboxId);
  if (decoded.provider === "github") {
    throw new Error("GitHub Actions jobs do not expose a live sandbox filesystem.");
  }
  if (decoded.provider === "e2b") {
    return connectE2BSandbox(decoded.sandboxId);
  }

  const Sandbox = await loadSandboxSdk();
  return Sandbox.get({ ...sandboxCredentialsFromEnv(), sandboxId: decoded.sandboxId });
}

export async function startOpenGameJob({
  gameId,
  jobId,
  prompt,
  modelKey = "standard",
  skeletonKey = "auto",
  contentType = "GAME",
  sourceUrl,
  useContinue = false,
}: {
  gameId: string;
  jobId: string;
  prompt: string;
  modelKey?: GenerationModelKey;
  skeletonKey?: GameplaySkeletonKey;
  contentType?: ContentTypeValue;
  sourceUrl?: string | null;
  useContinue?: boolean;
}) {
  const normalizedModelKey = normalizeGenerationModelKey(modelKey);
  const normalizedSkeletonKey = normalizeGameplaySkeletonKey(skeletonKey);
  const [game, currentJob] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      select: { playUrl: true },
    }),
    prisma.job.findUnique({ where: { id: jobId }, select: { progress: true } }),
  ]);
  const hasPlayableVersion = Boolean(game?.playUrl);
  const currentProgress = currentJob?.progress ?? 0;

  if (sandboxProviderFromEnv() === "github") {
    const sandboxId = encodeSandboxId("github", jobId);
    const dispatch = shouldDispatchGithubWorkflow()
      ? await maybeTriggerGithubOpenGameWorkflow({ jobId }).catch((error) => {
          console.error("[github-worker] workflow dispatch failed; keeping job queued for the scheduled worker.", error);
          return null;
        })
      : null;
    const shouldStartLocalWorker = !dispatch && shouldAutoStartLocalGithubWorker();
    const dispatchFallbackLog =
      shouldDispatchGithubWorkflow() && !dispatch
        ? "\nGitHub workflow dispatch failed; the scheduled GitHub worker can still claim this job."
        : "";
    await prisma.job.update({
      where: { id: jobId },
      data: {
        sandboxId,
        status: "QUEUED",
        progress: mergeProgress(currentProgress, progressForJobStatus("queued")),
        modelKey: normalizedModelKey,
        skeletonKey: normalizedSkeletonKey,
        sourceUrl: sourceUrl ?? null,
        useContinue,
        log: dispatch
          ? `Queued GitHub Actions workflow ${dispatch.workflow} on ${dispatch.repo}@${dispatch.ref}.`
          : `${queuedGithubWorkerLog()}${dispatchFallbackLog}`,
      },
    });
    if (!hasPlayableVersion) {
      await prisma.game.update({
        where: { id: gameId },
        data: { status: "GENERATING" },
      });
    }
    if (shouldStartLocalWorker) startLocalGithubWorker(jobId);

    return sandboxId;
  }

  if (!process.env.MINIMAX_API_KEY) {
    throw new Error("Missing MINIMAX_API_KEY.");
  }

  let sandbox: SandboxHandle;
  try {
    sandbox = await createSandboxFromSnapshot();
  } catch (error) {
    throw new Error(describeSandboxError(error));
  }
  const sandboxId = sandbox.sandboxId;

  if (!sandboxId) {
    throw new Error("Sandbox did not return a sandboxId.");
  }

  const env = {
    OPENAI_API_KEY: process.env.MINIMAX_API_KEY ?? "",
    OPENAI_BASE_URL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
    OPENAI_MODEL: getOpenGameModelForKey(normalizedModelKey),
    GAME_TEMPLATES_DIR: `${OPENGAME_ROOT}/agent-test/templates`,
    GAME_DOCS_DIR: `${OPENGAME_ROOT}/agent-test/docs`,
    OPENGAME_SOURCE_URL: sourceUrl ?? "",
    OPENGAME_USE_CONTINUE: useContinue ? "1" : "",
  };

  await sandboxWriteFiles(sandbox, [
    { path: `${WORKSPACE_ROOT}/prompt.txt`, content: buildPlayablePrompt(prompt, normalizedSkeletonKey, contentType) },
    { path: RUN_SCRIPT, content: buildOpenGameScript() },
    { path: VALIDATOR_SCRIPT, content: buildPlayabilityValidatorScript() },
  ]);

  await sandbox.runCommand({
    cmd: "bash",
    args: [RUN_SCRIPT],
    env,
    detached: true,
  });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      sandboxId,
      status: "RUNNING",
        progress: mergeProgress(currentProgress, progressForJobStatus("running")),
      modelKey: normalizedModelKey,
      skeletonKey: normalizedSkeletonKey,
      sourceUrl: sourceUrl ?? null,
      useContinue,
      startedAt: new Date(),
    },
  });
  if (!hasPlayableVersion) {
    await prisma.game.update({
      where: { id: gameId },
      data: { status: "GENERATING" },
    });
  }

  return sandboxId;
}

export async function readSandboxText(sandboxId: string, path: string) {
  const sandbox = await getSandbox(sandboxId);
  return streamToString(await sandboxReadFile(sandbox, path));
}

async function sandboxFileExists(sandbox: SandboxHandle, path: string) {
  try {
    await sandboxReadFile(sandbox, path);
    return true;
  } catch {
    return false;
  }
}

export async function hasGeneratedIndex(sandboxId: string) {
  const sandbox = await getSandbox(sandboxId);
  const indexHtml = await streamToString(
    await sandboxReadFile(sandbox, `${GENERATED_DIR}/index.html`),
  ).catch(() => "");

  return indexHtml.trim().length > 0;
}

export async function hasPlayableBuild(sandboxId: string) {
  const sandbox = await getSandbox(sandboxId);
  const [playableMarkerExists, indexHtml] = await Promise.all([
    sandboxFileExists(sandbox, PLAYABLE_MARKER),
    streamToString(await sandboxReadFile(sandbox, `${GENERATED_DIR}/index.html`)).catch(() => ""),
  ]);

  return playableMarkerExists && indexHtml.trim().length > 0;
}

async function readSandboxTextOrEmpty(sandboxId: string, path: string) {
  try {
    return await readSandboxText(sandboxId, path);
  } catch (error) {
    if (isSandboxUnrecoverableProvisioningError(error)) throw error;
    return "";
  }
}

async function readSandboxPhaseOrEmpty(sandboxId: string) {
  return (await readSandboxTextOrEmpty(sandboxId, PHASE_FILE)).trim();
}

async function hasPlayableBuildOrFalse(sandboxId: string) {
  try {
    return await hasPlayableBuild(sandboxId);
  } catch (error) {
    if (isSandboxUnrecoverableProvisioningError(error)) throw error;
    return false;
  }
}

async function failJob(jobId: string, gameId: string, errorMsg: string) {
  return retryOpenGameJob(jobId, errorMsg, { log: `Generation failed for game ${gameId}: ${errorMsg}` });
}

function buildRetryPrompt(prompt: string, errorMsg: string, log?: string | null, skeletonKey?: GameplaySkeletonKey) {
  return [
    "You are regenerating this HTML5 game because the previous attempt did not produce a published READY build.",
    "",
    "Original generation prompt:",
    prompt,
    "",
    "Previous failure reason:",
    errorMsg || "Unknown generation failure.",
    "",
    log ? `Recent failed run log:\n${tailLines(log, 30)}` : "",
    "",
    "Astrocade-grade recovery direction:",
    "- Rebuild this as a smaller but more premium-feeling game.",
    "- Lock onto one polished gameplay archetype and one coherent visual system.",
    "- The next result must feel curated: strong first screen, clean HUD, clear end state, and zero placeholder UI.",
    "",
    ...buildGameplayBlueprintSection(prompt, skeletonKey),
    "",
    "Mandatory recovery contract:",
    "- Keep retrying toward a playable READY build, not a partial draft.",
    "- Prefer a simpler single-screen game over an ambitious unstable game.",
    "- Produce a self-contained non-empty index.html.",
    "- Ensure the start/click path works and keyboard input changes visible game state.",
    "- Ensure keyboard, mouse/pointer, and mobile touch gestures all change visible game state or have explicit equivalent actions; slice/drag/draw/aim games must respond to automated swipes through the playfield.",
    "- Ensure mobile phone-sized layout and touch gestures work: no off-screen controls, no accidental page scroll, and tap/swipe/drag should be playable.",
    "- Ensure active targets are reachable and visible: they must enter the upper/middle playfield, not remain trapped near the bottom or outside the safe zone.",
    "- Ensure the game has at least 3 levels/waves/rounds/stages or an equivalent multi-step progression, with HUD/overlay text showing current progression.",
    "- If any feature is risky, remove or simplify it so the playable smoke test passes.",
    "- Pass visual quality validation: non-pixel-art by default, no 8-bit/blocky/pixelated styling, polished modern UI, designed HUD/start/end screens, gradients, rounded controls, shadows/glow, animated background accents, and responsive layout.",
    "- Add a designed start screen, a readable HUD with multiple state modules, and a replay-ready end-state overlay.",
    "- Ensure the whole play surface, HUD, and CTA/result controls fit inside the viewport; fix any clipping with responsive layout or letterboxed scaling.",
    "- Add or preserve window.__OPENGAME_DEBUG__ so validation can confirm target reachability, input coverage, and level/wave/round progression.",
    "- Replace plain buttons, bare text, and flat backgrounds with premium surfaces, consistent theme tokens, spacing rhythm, and CTA hierarchy.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function findNewerLiveJob(job: { id: string; gameId: string; createdAt: Date }) {
  return prisma.job.findFirst({
    where: {
      id: { not: job.id },
      gameId: job.gameId,
      createdAt: { gt: job.createdAt },
      status: { in: [...ACTIVE_JOB_STATUSES, "DONE"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, log: true, errorMsg: true },
  });
}

async function countAutomaticRetryJobsSinceLastPublished(job: { gameId: string; createdAt: Date }) {
  const lastPublishedJob = await prisma.job.findFirst({
    where: {
      gameId: job.gameId,
      status: "DONE",
      createdAt: { lt: job.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return prisma.message.count({
    where: {
      gameId: job.gameId,
      role: "SYSTEM",
      content: { startsWith: AUTO_RETRY_MESSAGE_PREFIX },
      ...(lastPublishedJob ? { createdAt: { gt: lastPublishedJob.createdAt } } : {}),
    },
  });
}

export async function retryOpenGameJob(jobId: string, errorMsg: string, options: { log?: string | null } = {}) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { game: true } });
  if (!job) throw new Error("Job not found.");

  if (job.status === "FAILED" && job.log?.includes(RETRY_LIMIT_LOG_MARKER)) {
    return { status: "failed", log: tailLines(job.log, 40), errorMsg: job.errorMsg ?? errorMsg };
  }

  const newerActiveJob = await findNewerLiveJob(job);

  if (newerActiveJob) {
    return {
      status: newerActiveJob.status.toLowerCase(),
      progress: newerActiveJob.progress,
      log: tailLines(newerActiveJob.log ?? options.log ?? "", 40),
      errorMsg: newerActiveJob.errorMsg,
      nextJobId: newerActiveJob.id,
    };
  }

  const automaticRetryCount = await countAutomaticRetryJobsSinceLastPublished(job);
  if (automaticRetryCount >= MAX_AUTOMATIC_RETRY_JOBS) {
    const finalLog = [
      options.log,
      "",
      `[retry] Previous attempt did not publish a READY build: ${errorMsg}`,
      `${RETRY_LIMIT_LOG_MARKER} (${automaticRetryCount}/${MAX_AUTOMATIC_RETRY_JOBS}).`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(-8000);

    await prisma.$transaction([
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMsg,
          log: finalLog,
          finishedAt: new Date(),
        },
      }),
      prisma.game.update({
        where: { id: job.gameId },
        data: { status: job.game.playUrl ? "READY" : "FAILED" },
      }),
      prisma.message.create({
        data: {
          gameId: job.gameId,
          role: "SYSTEM",
          content: `自动重试已达到上限，生成停止。\n失败原因:\n${errorMsg}`,
          jobId: job.id,
        },
      }),
    ]);

    return { status: "failed", log: tailLines(finalLog, 40), errorMsg };
  }

  const normalizedSkeletonKey = normalizeGameplaySkeletonKey(job.skeletonKey);
  const retryPrompt = buildRetryPrompt(job.prompt, errorMsg, options.log, normalizedSkeletonKey);
  const retryJob = await prisma.job.create({
    data: {
      gameId: job.gameId,
      modelKey: normalizeGenerationModelKey(job.modelKey),
      skeletonKey: normalizedSkeletonKey,
      prompt: retryPrompt,
      status: "QUEUED",
      progress: progressForJobStatus("queued"),
      sourceUrl: job.game.sourceUrl ?? job.sourceUrl,
      useContinue: Boolean(job.game.playUrl && (job.useContinue || job.game.sourceUrl || job.sourceUrl)),
      log: "Queued retry after the previous generation attempt failed. The service will keep retrying until a READY build is published.",
    },
  });

  const retryLog = [
    options.log,
    "",
    `[retry] Previous attempt did not publish a READY build: ${errorMsg}`,
    `[retry] Created follow-up job ${retryJob.id}.`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(-8000);

  await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: {
        status: "REPAIRING",
        progress: mergeProgress(job.progress, progressForJobStatus("repairing")),
        errorMsg,
        log: retryLog,
        finishedAt: new Date(),
      },
    }),
    prisma.game.update({
      where: { id: job.gameId },
      data: { status: job.game.playUrl ? "READY" : "GENERATING" },
    }),
    prisma.message.create({
      data: {
        gameId: job.gameId,
        role: "SYSTEM",
        content: `${AUTO_RETRY_MESSAGE_PREFIX}\n失败原因:\n${errorMsg}`,
        jobId: retryJob.id,
      },
    }),
  ]);

  await startOpenGameJob({
    gameId: job.gameId,
    jobId: retryJob.id,
    prompt: retryPrompt,
    modelKey: normalizeGenerationModelKey(retryJob.modelKey),
    skeletonKey: normalizedSkeletonKey,
    contentType: job.game.contentType,
    sourceUrl: retryJob.sourceUrl,
    useContinue: retryJob.useContinue,
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : "Retry job failed to start.";
    await prisma.job.update({
      where: { id: retryJob.id },
      data: {
        status: "QUEUED",
        progress: mergeProgress(retryJob.progress, progressForJobStatus("queued")),
        errorMsg: message,
        log: `Retry job is still queued, but automatic start reported: ${message}`.slice(-8000),
      },
    });
  });

  return {
    status: "repairing",
    progress: mergeProgress(job.progress, progressForJobStatus("repairing")),
    log: tailLines(retryLog, 40),
    errorMsg,
    nextJobId: retryJob.id,
  };
}

export async function getJobProgress(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const newerLiveJob = await findNewerLiveJob(job);
  if (newerLiveJob) {
    return {
      status: newerLiveJob.status.toLowerCase(),
      progress: newerLiveJob.progress,
      log: tailLines(newerLiveJob.log ?? job.log ?? "", 40),
      errorMsg: newerLiveJob.errorMsg,
      nextJobId: newerLiveJob.id,
      blocker: queuedJobBlocker({ status: newerLiveJob.status, createdAt: job.createdAt, log: newerLiveJob.log }),
    };
  }

  if (!job.sandboxId || job.sandboxId.startsWith("github:")) {
    if (job.status === "FAILED") {
      return failJob(job.id, job.gameId, job.errorMsg ?? "GitHub Actions worker failed.");
    }

    if (job.sandboxId?.startsWith("github:") && job.status === "QUEUED" && shouldAutoStartLocalGithubWorker()) {
      const started = startLocalGithubWorker(job.id);
      if (started) {
        const log = queuedGithubWorkerLog();
        const progress = await updateJobProgress(job.id, progressForJobStatus("queued"));
        await prisma.job.update({ where: { id: job.id }, data: { log, progress } });
        return { status: "queued", progress, log, errorMsg: job.errorMsg, blocker: queuedJobBlocker({ status: "QUEUED", createdAt: job.createdAt, log }) };
      }
    }

    if (
      job.sandboxId?.startsWith("github:") &&
      job.startedAt &&
      job.status !== "DONE" &&
      Date.now() - job.startedAt.getTime() > MAX_JOB_MS
    ) {
      const errorMsg = "Generation timed out after 30 minutes.";
      return failJob(job.id, job.gameId, errorMsg);
    }

    const progress = await updateJobProgress(job.id, progressForJobStatus(job.status));
    return {
      status: job.status.toLowerCase(),
      progress,
      log: tailLines(job.log ?? "", 40),
      errorMsg: job.errorMsg,
      blocker: queuedJobBlocker({ status: job.status, createdAt: job.createdAt, log: job.log }),
    };
  }

  if (job.status === "DONE") {
    const progress = await updateJobProgress(job.id, progressForJobStatus("done"));
    return { status: job.status.toLowerCase(), progress, log: tailLines(job.log ?? "", 40), errorMsg: job.errorMsg };
  }

  if (job.status === "FAILED") {
    return failJob(job.id, job.gameId, job.errorMsg ?? "Generation job reached FAILED state.");
  }

  if (job.startedAt && Date.now() - job.startedAt.getTime() > MAX_JOB_MS) {
    const errorMsg = "Generation timed out after 30 minutes.";
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return failJob(job.id, job.gameId, errorMsg);
  }

  let log = "";
  let err = "";
  let validationLog = "";
  let phase = "";
  let hasPlayable = false;

  try {
    [log, err, validationLog, phase, hasPlayable] = await Promise.all([
      readSandboxTextOrEmpty(job.sandboxId, PROGRESS_LOG),
      readSandboxTextOrEmpty(job.sandboxId, ERROR_LOG),
      readSandboxTextOrEmpty(job.sandboxId, VALIDATION_LOG),
      readSandboxPhaseOrEmpty(job.sandboxId),
      hasPlayableBuildOrFalse(job.sandboxId),
    ]);
  } catch (error) {
    const errorMsg = describeSandboxError(error);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return failJob(job.id, job.gameId, errorMsg);
  }

  const combinedLog = [log, validationLog ? `[validation log]\n${validationLog}` : ""].filter(Boolean).join("\n");

  if (hasPlayable) {
    const progress = mergeProgress(job.progress, progressFromPhaseAndLog("finishing", combinedLog));
    await prisma.job.update({ where: { id: job.id }, data: { status: "FINISHING", progress } });
    return { status: "finishing", progress, log: tailLines(combinedLog, 40), errorMsg: null };
  }

  let exitCode = "";
  try {
    exitCode = await readSandboxTextOrEmpty(job.sandboxId, EXIT_CODE_FILE);
  } catch (error) {
    const errorMsg = describeSandboxError(error);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return retryOpenGameJob(job.id, errorMsg, { log: combinedLog });
  }
  const hasExited = exitCode.trim().length > 0;

  if (hasExited || /(401|429|authentication|unauthorized|invalid api key|ECONNREFUSED)/i.test(err)) {
    const errorMsg = tailLines(
      err || validationLog || log || "OpenGame exited without a playable validated game.",
      40,
    ).slice(0, 2000);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return retryOpenGameJob(job.id, errorMsg, { log: combinedLog });
  }

  if (phase === "VALIDATING" || phase === "REPAIRING") {
    const nextStatus = phase === "VALIDATING" ? "VALIDATING" : "REPAIRING";
    const progress = mergeProgress(job.progress, progressFromPhaseAndLog(nextStatus, combinedLog));
    await prisma.job.update({ where: { id: job.id }, data: { status: nextStatus, progress } });
    return { status: nextStatus.toLowerCase(), progress, log: tailLines(combinedLog, 40), errorMsg: null };
  }

  const fallbackStatus = job.status === "VALIDATING" || job.status === "REPAIRING" ? job.status : "RUNNING";
  const progress = await updateJobProgress(job.id, progressFromPhaseAndLog(fallbackStatus, combinedLog));
  return { status: fallbackStatus.toLowerCase(), progress, log: tailLines(combinedLog, 40), errorMsg: null };
}

export async function stopSandbox(sandboxId: string) {
  if (sandboxId.startsWith("github:")) return;
  const sandbox = await getSandbox(sandboxId);
  await sandbox.stop?.();
}

export const sandboxPaths = {
  workspaceRoot: WORKSPACE_ROOT,
  opengameRoot: OPENGAME_ROOT,
  generatedDir: GENERATED_DIR,
  progressLog: PROGRESS_LOG,
  errorLog: ERROR_LOG,
  validationLog: VALIDATION_LOG,
  exitCodeFile: EXIT_CODE_FILE,
  phaseFile: PHASE_FILE,
  validationReport: VALIDATION_REPORT,
  playableMarker: PLAYABLE_MARKER,
  runScript: RUN_SCRIPT,
  validatorScript: VALIDATOR_SCRIPT,
};
