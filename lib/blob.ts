import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getSandbox } from "@/lib/sandbox";

const execFileAsync = promisify(execFile);

const RAILWAY_STORAGE_PREFIX = "railway://";

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

function storageRoot() {
  return process.env.OPENGAME_STORAGE_DIR?.trim() || path.join(process.cwd(), ".opengame-storage");
}

function storedPath(key: string) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith(".")) {
    throw new Error(`Unsafe storage path: ${key}`);
  }
  return path.join(storageRoot(), ...normalized.split("/"));
}

function railwayStorageUrl(key: string) {
  return `${RAILWAY_STORAGE_PREFIX}${key.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function isRailwayStorageUrl(value?: string | null) {
  return Boolean(value?.startsWith(RAILWAY_STORAGE_PREFIX));
}

export function railwayStorageKey(value: string) {
  if (!isRailwayStorageUrl(value)) throw new Error("Invalid Railway storage URL.");
  return value.slice(RAILWAY_STORAGE_PREFIX.length);
}

export async function readRailwayStoredFile(storageUrl: string) {
  return readFile(storedPath(railwayStorageKey(storageUrl)));
}

export async function readRailwayGameFile(gameId: string, filePath: string) {
  return readFile(storedPath(`games/${gameId}/play/${safeBlobPath(filePath)}`));
}

export async function readRailwayGameAsset(gameId: string, filePath: string) {
  return readFile(storedPath(`games/${gameId}/assets/${safeBlobPath(filePath)}`));
}

export async function writeRailwayGameAsset(gameId: string, filePath: string, body: Buffer | Uint8Array) {
  await writeRailwayStoredFile(`games/${gameId}/assets/${safeBlobPath(filePath)}`, body);
}

async function writeRailwayStoredFile(key: string, body: Buffer | Uint8Array) {
  const target = storedPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return railwayStorageUrl(key);
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
    await writeRailwayStoredFile(`games/${gameId}/play/${safeBlobPath(file)}`, body);

    if (file === "index.html") {
      playUrl = railwayStorageUrl(`games/${gameId}/play/index.html`);
    }
  }

  if (!playUrl) {
    throw new Error("Generated game does not include index.html.");
  }

  return { playUrl, fileCount: files.length };
}

function safeBlobPath(file: string) {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith(".")) {
    throw new Error(`Unsafe generated file path: ${file}`);
  }

  return normalized;
}

export async function uploadGameFileBuffers({
  gameId,
  files,
}: {
  gameId: string;
  files: Array<{ path: string; body: Buffer }>;
}) {
  let playUrl: string | null = null;

  for (const file of files) {
    const filePath = safeBlobPath(file.path);
    await writeRailwayStoredFile(`games/${gameId}/play/${filePath}`, file.body);

    if (filePath === "index.html") {
      playUrl = railwayStorageUrl(`games/${gameId}/play/index.html`);
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
    await writeRailwayStoredFile(`games/${gameId}/play/${safeBlobPath(file)}`, body);

    if (file === "index.html") {
      playUrl = railwayStorageUrl(`games/${gameId}/play/index.html`);
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
  return writeRailwayStoredFile(`games/${gameId}/source.zip`, body);
}

export async function uploadSourceArchiveBuffer({ gameId, body }: { gameId: string; body: Buffer }) {
  return writeRailwayStoredFile(`games/${gameId}/source.zip`, body);
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
  return writeRailwayStoredFile(`games/${gameId}/source.zip`, body);
}
