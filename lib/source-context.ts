import path from "node:path";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { isRailwayStorageUrl, readRailwayStoredFile } from "@/lib/blob";
import { parseBuiltinCopyPlayUrl } from "@/lib/builtin-games";

const TEXT_FILE_RE = /\.(html|css|js|json|ts|tsx|md|txt)$/i;
const MAX_FILE_BYTES = 120_000;
const MAX_CONTEXT_CHARS = 24_000;

type SourceGame = {
  title: string;
  playUrl?: string | null;
  sourceUrl?: string | null;
};

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (readUInt32(buffer, i) === 0x06054b50) return i;
  }
  return -1;
}

function parseZipTextFiles(buffer: Buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return [];

  const entryCount = readUInt16(buffer, eocd + 10);
  const centralDirectoryOffset = readUInt32(buffer, eocd + 16);
  const files: Array<{ path: string; content: string }> = [];
  let cursor = centralDirectoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) break;

    const compression = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const uncompressedSize = readUInt32(buffer, cursor + 24);
    const nameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localHeaderOffset = readUInt32(buffer, cursor + 42);
    const path = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    cursor += 46 + nameLength + extraLength + commentLength;

    if (!TEXT_FILE_RE.test(path) || uncompressedSize > MAX_FILE_BYTES) continue;
    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) continue;

    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content = "";
    try {
      content =
        compression === 0
          ? compressed.toString("utf8")
          : compression === 8
            ? inflateRawSync(compressed).toString("utf8")
            : "";
    } catch {
      content = "";
    }

    if (content.trim()) files.push({ path, content });
  }

  return files;
}

async function fetchAsBuffer(url: string) {
  if (isRailwayStorageUrl(url)) {
    return readRailwayStoredFile(url);
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function readBuiltinTemplateContext(playUrl: string, title: string) {
  const slug = parseBuiltinCopyPlayUrl(playUrl);
  if (!slug) return "";

  const publicRoot = path.join(process.cwd(), "public", "builtin-games");
  const [indexHtml, sharedEngine] = await Promise.all([
    readFile(path.join(publicRoot, slug, "index.html"), "utf8").catch(() => ""),
    readFile(path.join(publicRoot, "shared", "engine.js"), "utf8").catch(() => ""),
  ]);

  if (!indexHtml.trim() && !sharedEngine.trim()) return "";

  return capContext(
    [
      `Original game title: ${title}`,
      "Original builtin template files:",
      indexHtml.trim() ? `\n--- index.html ---\n${indexHtml}` : "",
      sharedEngine.trim() ? `\n--- shared/engine.js ---\n${sharedEngine}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function capContext(value: string) {
  return value.length > MAX_CONTEXT_CHARS
    ? `${value.slice(0, MAX_CONTEXT_CHARS)}\n\n[Source context truncated for prompt budget.]`
    : value;
}

export async function buildSourceContext(game: SourceGame) {
  if (game.playUrl) {
    const builtinContext = await readBuiltinTemplateContext(game.playUrl, game.title).catch(() => "");
    if (builtinContext) return builtinContext;
  }

  if (game.sourceUrl) {
    const archive = await fetchAsBuffer(game.sourceUrl).catch(() => null);
    if (archive) {
      const files = parseZipTextFiles(archive)
        .sort((a, b) => {
          if (a.path === "index.html") return -1;
          if (b.path === "index.html") return 1;
          return a.path.localeCompare(b.path);
        })
        .slice(0, 12);

      if (files.length) {
        return capContext(
          [
            `Original game title: ${game.title}`,
            "Original source files:",
            ...files.map((file) => `\n--- ${file.path} ---\n${file.content}`),
          ].join("\n"),
        );
      }
    }
  }

  if (game.playUrl) {
    const html = isRailwayStorageUrl(game.playUrl)
      ? await readRailwayStoredFile(game.playUrl)
          .then((body) => body.toString("utf8"))
          .catch(() => "")
      : await fetch(game.playUrl)
          .then(async (response) => (response.ok ? response.text() : ""))
          .catch(() => "");
    if (html.trim()) {
      return capContext(`Original game title: ${game.title}\nOriginal index.html:\n${html}`);
    }
  }

  return `Original game title: ${game.title}\nSource code is unavailable; preserve the visible gameplay as much as possible.`;
}
