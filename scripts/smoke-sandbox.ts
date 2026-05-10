import { loadDotEnv } from "./load-env";
import { createSandboxFromSnapshot, getSandbox, stopSandbox } from "../lib/sandbox";
import { describeSandboxError } from "../lib/vercel-sandbox-auth";

loadDotEnv();

async function commandStdout(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  if ("stdout" in result && typeof result.stdout === "string") return result.stdout;
  if ("stdout" in result && typeof result.stdout === "function") {
    return (await (result.stdout as () => Promise<string>)()) ?? "";
  }
  return "";
}

const sandbox = await createSandboxFromSnapshot().catch((error: unknown) => {
  throw new Error(describeSandboxError(error));
});

try {
  const sandboxId = sandbox.sandboxId;
  if (!sandboxId) throw new Error("Sandbox did not return sandboxId.");

  await sandbox.runCommand({ cmd: "bash", args: ["-lc", "mkdir -p /tmp/opengame-workspace && echo sandbox-ok > /tmp/opengame-workspace/smoke.txt"] });
  const restored = await getSandbox(sandboxId);
  const result = await restored.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cat /tmp/opengame-workspace/smoke.txt",
        process.env.E2B_TEMPLATE_ID || process.env.OPENGAME_SNAPSHOT_ID
          ? "(test -f /tmp/opengame-workspace/opengame/dist/cli.js || test -f /opt/opengame/dist/cli.js || test -x /opt/opengame/bin/opengame) && echo opengame-ok"
          : "echo cold-start-mode",
        process.env.E2B_TEMPLATE_ID || process.env.OPENGAME_SNAPSHOT_ID
          ? "(test -d /tmp/opengame-workspace/browser-runtime/node_modules/playwright-chromium || command -v chromium || command -v chromium-browser) && echo browser-runtime-ok"
          : "echo browser-cold-start-mode",
      ].join(" && "),
    ],
  });

  console.log(await commandStdout(result));
} finally {
  if (sandbox.sandboxId) await stopSandbox(sandbox.sandboxId).catch(() => undefined);
}

export {};
