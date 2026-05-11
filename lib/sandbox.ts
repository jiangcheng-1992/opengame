import { spawn } from "node:child_process";
import path from "node:path";
import { prisma } from "@/lib/db";
import { maybeTriggerGithubOpenGameWorkflow } from "@/lib/github-actions";
import { buildPlayabilityValidatorScript } from "@/lib/playability-validator-script";
import { tailLines } from "@/lib/status";
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

function queuedGithubWorkerLog() {
  if (process.env.VERCEL) return "Queued for the next scheduled GitHub Actions worker run.";
  return "Queued locally. A local GitHub-compatible worker is starting automatically and will claim this job.";
}

function shouldDispatchGithubWorkflow() {
  return Boolean(process.env.VERCEL || process.env.GITHUB_ACTIONS || process.env.FORCE_GITHUB_DISPATCH === "1");
}

function shouldAutoStartLocalGithubWorker() {
  return !process.env.VERCEL && !process.env.GITHUB_ACTIONS && process.env.DISABLE_LOCAL_GITHUB_WORKER !== "1";
}

function localWorkerBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function startLocalGithubWorker(jobId: string) {
  if (localGithubWorkerJobs.has(jobId)) return false;
  localGithubWorkerJobs.add(jobId);

  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const child = spawn(tsxBin, ["scripts/run-github-opengame-job.ts", jobId], {
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

ensure_tools() {
  local missing_core=""
  for tool in git zip unzip node npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing_core="$missing_core $tool"
    fi
  done

  if [ -n "$missing_core" ]; then
    echo "[setup] Installing sandbox system tools..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update || return $?
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git zip unzip nodejs npm curl ca-certificates || return $?
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y git zip unzip nodejs npm curl-minimal || return $?
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y git zip unzip nodejs npm curl || return $?
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
    if [ "$OPENGAME_MODE" = "node" ]; then
      node "$OPENGAME_BIN" --continue -p "$prompt" --yolo
    else
      "$OPENGAME_BIN" --continue -p "$prompt" --yolo
    fi
  else
    echo "[opengame] Starting generation in $GENERATED_DIR"
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
}

write_repair_prompt() {
  local attempt="$1"
  local report
  report="$(cat "$VALIDATION_REPORT" 2>/dev/null)"
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
      return 0
    fi

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

export function buildPlayablePrompt(prompt: string) {
  return [
    "Build a playable HTML5 game from the user's creative request.",
    "",
    "User creative request:",
    prompt,
    "",
    "Hard delivery contract:",
    "- Produce a self-contained playable HTML5 game with a non-empty index.html entry.",
    "- The first visible start/play button or centered start area must respond to a click.",
    "- The game must enter a core loop after start, with visible state such as score, level, lives, timer, enemies, or progress.",
    "- Keyboard input with arrows, WASD, and Space should affect gameplay when relevant.",
    "- Include clear failure, win, score, or restart feedback; simplify the mechanics if needed to make it reliable.",
    "- Do not leave a modal, overlay, or intro screen permanently intercepting player input after start.",
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
  sourceUrl,
  useContinue = false,
}: {
  gameId: string;
  jobId: string;
  prompt: string;
  sourceUrl?: string | null;
  useContinue?: boolean;
}) {
  if (sandboxProviderFromEnv() === "github") {
    const sandboxId = encodeSandboxId("github", jobId);
    const dispatch = shouldDispatchGithubWorkflow() ? await maybeTriggerGithubOpenGameWorkflow({ jobId }) : null;
    const shouldStartLocalWorker = !dispatch && shouldAutoStartLocalGithubWorker();
    await prisma.job.update({
      where: { id: jobId },
      data: {
        sandboxId,
        status: "QUEUED",
        sourceUrl: sourceUrl ?? null,
        useContinue,
        log: dispatch
          ? `Queued GitHub Actions workflow ${dispatch.workflow} on ${dispatch.repo}@${dispatch.ref}.`
          : queuedGithubWorkerLog(),
      },
    });
    await prisma.game.update({
      where: { id: gameId },
      data: { status: "GENERATING" },
    });
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
    OPENAI_MODEL: "MiniMax-M2.7",
    GAME_TEMPLATES_DIR: `${OPENGAME_ROOT}/agent-test/templates`,
    GAME_DOCS_DIR: `${OPENGAME_ROOT}/agent-test/docs`,
    OPENGAME_SOURCE_URL: sourceUrl ?? "",
    OPENGAME_USE_CONTINUE: useContinue ? "1" : "",
  };

  await sandboxWriteFiles(sandbox, [
    { path: `${WORKSPACE_ROOT}/prompt.txt`, content: buildPlayablePrompt(prompt) },
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
      sourceUrl: sourceUrl ?? null,
      useContinue,
      startedAt: new Date(),
    },
  });
  await prisma.game.update({
    where: { id: gameId },
    data: { status: "GENERATING" },
  });

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
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { playUrl: true } });
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "FAILED", errorMsg, finishedAt: new Date() },
  });
  await prisma.game.update({
    where: { id: gameId },
    data: { status: game?.playUrl ? "READY" : "FAILED" },
  });
}

export async function getJobProgress(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.sandboxId || job.sandboxId.startsWith("github:")) {
    if (job.sandboxId?.startsWith("github:") && job.status === "QUEUED" && shouldAutoStartLocalGithubWorker()) {
      const started = startLocalGithubWorker(job.id);
      if (started) {
        const log = queuedGithubWorkerLog();
        await prisma.job.update({ where: { id: job.id }, data: { log } });
        return { status: "queued", log, errorMsg: job.errorMsg };
      }
    }

    if (
      job.sandboxId?.startsWith("github:") &&
      job.startedAt &&
      job.status !== "DONE" &&
      job.status !== "FAILED" &&
      Date.now() - job.startedAt.getTime() > MAX_JOB_MS
    ) {
      const errorMsg = "Generation timed out after 30 minutes.";
      await failJob(job.id, job.gameId, errorMsg);
      return { status: "failed", log: tailLines(job.log ?? "", 40), errorMsg };
    }

    return { status: job.status.toLowerCase(), log: tailLines(job.log ?? "", 40), errorMsg: job.errorMsg };
  }

  if (job.status === "DONE" || job.status === "FAILED") {
    return { status: job.status.toLowerCase(), log: tailLines(job.log ?? "", 40), errorMsg: job.errorMsg };
  }

  if (job.startedAt && Date.now() - job.startedAt.getTime() > MAX_JOB_MS) {
    const errorMsg = "Generation timed out after 30 minutes.";
    await failJob(job.id, job.gameId, errorMsg);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return { status: "failed", log: "", errorMsg };
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
    await failJob(job.id, job.gameId, errorMsg);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return { status: "failed", log: "", errorMsg };
  }

  const combinedLog = [log, validationLog ? `[validation log]\n${validationLog}` : ""].filter(Boolean).join("\n");

  if (hasPlayable) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "FINISHING" } });
    return { status: "finishing", log: tailLines(combinedLog, 40), errorMsg: null };
  }

  let exitCode = "";
  try {
    exitCode = await readSandboxTextOrEmpty(job.sandboxId, EXIT_CODE_FILE);
  } catch (error) {
    const errorMsg = describeSandboxError(error);
    await failJob(job.id, job.gameId, errorMsg);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return { status: "failed", log: tailLines(combinedLog, 40), errorMsg };
  }
  const hasExited = exitCode.trim().length > 0;

  if (hasExited || /(401|429|authentication|unauthorized|invalid api key|ECONNREFUSED)/i.test(err)) {
    const errorMsg = tailLines(
      err || validationLog || log || "OpenGame exited without a playable validated game.",
      40,
    ).slice(0, 2000);
    await failJob(job.id, job.gameId, errorMsg);
    await stopSandbox(job.sandboxId).catch(() => undefined);
    return { status: "failed", log: tailLines(combinedLog, 40), errorMsg };
  }

  if (phase === "VALIDATING" || phase === "REPAIRING") {
    const nextStatus = phase === "VALIDATING" ? "VALIDATING" : "REPAIRING";
    await prisma.job.update({ where: { id: job.id }, data: { status: nextStatus } });
    return { status: nextStatus.toLowerCase(), log: tailLines(combinedLog, 40), errorMsg: null };
  }

  return { status: "running", log: tailLines(combinedLog, 40), errorMsg: null };
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
