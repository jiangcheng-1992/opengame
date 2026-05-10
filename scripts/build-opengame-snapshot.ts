import { loadDotEnv } from "./load-env";
import { sandboxCredentialsFromEnv } from "../lib/vercel-sandbox-auth";

loadDotEnv();

const mod = await import("@vercel/sandbox");
function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

const Sandbox = (mod as unknown as {
  Sandbox: {
    create: (input: unknown) => Promise<{
      sandboxId?: string;
      runCommand: (input: unknown) => Promise<unknown>;
      snapshot?: () => Promise<string | { snapshotId?: string }>;
      stop?: () => Promise<unknown>;
    }>;
  };
}).Sandbox;

const sandbox = await Sandbox.create({
  ...sandboxCredentialsFromEnv(),
  runtime: "node22",
  timeout: 45 * 60 * 1000,
  resources: { vcpus: 2 },
});

try {
  const opengameGitUrl = process.env.OPENGAME_GIT_URL ?? "https://github.com/leigest519/OpenGame.git";
  const browserDeps =
    "nspr nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm pango cairo alsa-lib libxcb gtk3";
  const result = (await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        `sudo dnf install -y git zip unzip ${browserDeps}`,
        "rm -rf /vercel/sandbox/opengame",
        `git clone --depth 1 ${shellQuote(opengameGitUrl)} /vercel/sandbox/opengame`,
        "cd /vercel/sandbox/opengame",
        "npm install",
        "npm run build",
        "test -f /vercel/sandbox/opengame/dist/cli.js",
        "mkdir -p /vercel/sandbox/browser-runtime",
        "cd /vercel/sandbox/browser-runtime",
        "npm init -y >/dev/null 2>&1",
        "PLAYWRIGHT_BROWSERS_PATH=0 npm install --no-save playwright-chromium@1.49.1",
        "node -e \"const { chromium } = require('playwright-chromium'); console.log(chromium.executablePath())\"",
      ].join(" && "),
    ],
  })) as { exitCode?: number; stdout?: () => Promise<string>; stderr?: () => Promise<string> };

  if (result.exitCode && result.exitCode !== 0) {
    console.error(await result.stderr?.());
    throw new Error(`OpenGame snapshot setup failed with code ${result.exitCode}.`);
  }

  if (sandbox.snapshot) {
    const snapshot = await sandbox.snapshot();
    const snapshotId = typeof snapshot === "string" ? snapshot : snapshot.snapshotId;
    console.log(`OPENGAME_SNAPSHOT_ID=${snapshotId}`);
  } else {
    console.log(
      [
        "OpenGame setup finished, but this @vercel/sandbox version does not expose a snapshot API.",
        `Temporary sandboxId=${sandbox.sandboxId ?? "unknown"}`,
        "Runtime jobs will use the cold-start OPENGAME_GIT_URL fallback unless a snapshot-capable SDK is available.",
      ].join("\n"),
    );
  }
} finally {
  await sandbox.stop?.();
}

export {};
