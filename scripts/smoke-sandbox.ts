import { loadDotEnv } from "./load-env";
import { describeSandboxAuthError, sandboxCredentialsFromEnv } from "../lib/vercel-sandbox-auth";

loadDotEnv();

const mod = await import("@vercel/sandbox");

const Sandbox = (mod as unknown as {
  Sandbox: {
    create: (input: unknown) => Promise<{
      sandboxId?: string;
      runCommand: (input: unknown) => Promise<{ stdout?: string } | unknown>;
      stop?: () => Promise<unknown>;
    }>;
    get: (input: { sandboxId: string }) => Promise<{
      runCommand: (input: unknown) => Promise<{ stdout?: string } | unknown>;
    }>;
  };
}).Sandbox;

const sandbox = await Sandbox.create({
  ...sandboxCredentialsFromEnv(),
  timeout: 5 * 60 * 1000,
  ...(process.env.OPENGAME_SNAPSHOT_ID
    ? { source: { type: "snapshot", snapshotId: process.env.OPENGAME_SNAPSHOT_ID } }
    : { runtime: "node22" }),
}).catch((error: unknown) => {
  throw new Error(describeSandboxAuthError(error));
});

try {
  const sandboxId = sandbox.sandboxId;
  if (!sandboxId) throw new Error("Sandbox did not return sandboxId.");

  await sandbox.runCommand({ cmd: "bash", args: ["-lc", "echo sandbox-ok > /vercel/sandbox/smoke.txt"] });
  const restored = await Sandbox.get({ ...sandboxCredentialsFromEnv(), sandboxId });
  const result = await restored.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cat /vercel/sandbox/smoke.txt",
        process.env.OPENGAME_SNAPSHOT_ID
          ? "(test -f /vercel/sandbox/opengame/dist/cli.js || test -f /opt/opengame/dist/cli.js || test -x /opt/opengame/bin/opengame) && echo opengame-ok"
          : "echo cold-start-mode",
        process.env.OPENGAME_SNAPSHOT_ID
          ? "(test -d /vercel/sandbox/browser-runtime/node_modules/playwright-chromium || command -v chromium || command -v chromium-browser) && echo browser-runtime-ok"
          : "echo browser-cold-start-mode",
      ].join(" && "),
    ],
  });

  if (typeof result === "object" && result && "stdout" in result && typeof result.stdout === "function") {
    console.log(await result.stdout());
  } else if (typeof result === "object" && result && "stdout" in result) {
    console.log(result.stdout);
  } else {
    console.log(result);
  }
} finally {
  await sandbox.stop?.();
}

export {};
