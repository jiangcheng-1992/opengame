import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { put } from "@vercel/blob";
import { getSandbox } from "@/lib/sandbox";

const execFileAsync = promisify(execFile);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function extname(path: string) {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
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

async function toBuffer(value: unknown) {
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

async function sandboxFileToBuffer(sandboxId: string, path: string) {
  const sandbox = await getSandbox(sandboxId);
  if (sandbox.readFile) {
    try {
      return toBuffer(await sandbox.readFile({ path }));
    } catch {
      return toBuffer(await sandbox.readFile(path));
    }
  }

  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `base64 -w 0 ${shellQuote(path)}`],
  });

  return Buffer.from(await commandStdout(result), "base64");
}

function isIgnoredLocalPath(file: string) {
  return (
    file === "node_modules" ||
    file === ".git" ||
    file === "playwright-report" ||
    file === "test-results" ||
    file.endsWith(".log")
  );
}

async function listLocalFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (isIgnoredLocalPath(entry.name)) continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listLocalFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function listSandboxFiles(sandboxId: string, root: string) {
  const sandbox = await getSandbox(sandboxId);
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `cd ${shellQuote(root)} && find . -type f | sed 's#^./##'`],
  });

  return (await commandStdout(result))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("node_modules/"));
}

export async function uploadLocalGame({ gameId, root }: { gameId: string; root: string }) {
  const files = await listLocalFiles(root);
  let playUrl: string | null = null;

  for (const file of files) {
    const body = await readFile(path.join(root, file));
    const blob = await put(`games/${gameId}/play/${file}`, body, {
      access: "public",
      contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    if (file === "index.html") {
      playUrl = blob.url;
    }
  }

  if (!playUrl) {
    throw new Error("Generated game does not include index.html.");
  }

  return { playUrl, fileCount: files.length };
}

export async function uploadSandboxGame({
  sandboxId,
  gameId,
  root,
}: {
  sandboxId: string;
  gameId: string;
  root: string;
}) {
  const files = await listSandboxFiles(sandboxId, root);
  let playUrl: string | null = null;

  for (const file of files) {
    const body = await sandboxFileToBuffer(sandboxId, `${root}/${file}`);
    const blob = await put(`games/${gameId}/play/${file}`, body, {
      access: "public",
      contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    if (file === "index.html") {
      playUrl = blob.url;
    }
  }

  if (!playUrl) {
    throw new Error("Generated game does not include index.html.");
  }

  return { playUrl, fileCount: files.length };
}

export async function uploadLocalSourceArchive({ gameId, root }: { gameId: string; root: string }) {
  const archivePath = path.join("/tmp", `${gameId}.zip`);

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
    { cwd: root },
  );

  const body = await readFile(archivePath);
  const blob = await put(`games/${gameId}/source.zip`, body, {
    access: "public",
    contentType: "application/zip",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

export async function uploadSourceArchive({
  sandboxId,
  gameId,
  root,
}: {
  sandboxId: string;
  gameId: string;
  root: string;
}) {
  const sandbox = await getSandbox(sandboxId);
  const archivePath = `/tmp/${gameId}.zip`;

  await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        `cd ${shellQuote(root)}`,
        [
          `zip -qr ${shellQuote(archivePath)} .`,
          "-x 'node_modules/*'",
          "-x '*/node_modules/*'",
          "-x '.git/*'",
          "-x '*/.git/*'",
          "-x 'playwright-report/*'",
          "-x 'test-results/*'",
          "-x '*.log'",
        ].join(" "),
      ].join(" && "),
    ],
  });

  const body = await sandboxFileToBuffer(sandboxId, archivePath);
  const blob = await put(`games/${gameId}/source.zip`, body, {
    access: "public",
    contentType: "application/zip",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}
