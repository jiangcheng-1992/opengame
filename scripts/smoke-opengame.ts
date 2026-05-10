import { spawn } from "node:child_process";
import { readdir, stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "./load-env";

loadDotEnv();

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  throw new Error("Missing MINIMAX_API_KEY.");
}

const opengameBin = process.env.OPENGAME_BIN ?? "opengame";
const workdir = await mkdtemp(join(tmpdir(), "opengame-smoke-"));

await run(
  opengameBin,
  ["-p", "Build a tiny one-screen pong game with keyboard controls and a clear win condition.", "--yolo"],
  workdir,
  {
    ...process.env,
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
    OPENAI_MODEL: "MiniMax-M2.7",
  },
);

const files = await readdir(workdir);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
if (htmlFiles.length === 0) {
  throw new Error("OpenGame smoke finished without producing an HTML file.");
}

for (const htmlFile of htmlFiles) {
  const fileStat = await stat(join(workdir, htmlFile));
  if (fileStat.size === 0) {
    throw new Error(`OpenGame produced an empty HTML file: ${htmlFile}`);
  }
}

console.log(`OpenGame smoke output: ${workdir}`);
console.log(`HTML output: ${htmlFiles.join(", ")}`);

export {};
