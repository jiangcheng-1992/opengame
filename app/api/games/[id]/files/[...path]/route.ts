import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId } from "@/lib/auth";

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

function buildBlobFileUrl(playUrl: string, filePath: string) {
  const url = new URL(playUrl);
  const marker = "/play/";
  const markerIndex = url.pathname.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("Invalid stored playUrl.");

  const basePath = url.pathname.slice(0, markerIndex + marker.length);
  url.pathname = `${basePath}${filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  return url;
}

export async function GET(_: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  const [{ id, path }, anonId] = await Promise.all([context.params, getAnonId()]);
  const filePath = path.join("/");

  if (!filePath || filePath.includes("..")) {
    return NextResponse.json({ error: "文件路径无效。" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({
    where: { id },
    select: {
      ownerId: true,
      playUrl: true,
      status: true,
      visibility: true,
    },
  });

  if (!game?.playUrl || game.status !== "READY") {
    return NextResponse.json({ error: "找不到游戏文件。" }, { status: 404 });
  }

  if (game.visibility === "PRIVATE" && game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到游戏文件。" }, { status: 404 });
  }

  const blobUrl = buildBlobFileUrl(game.playUrl, filePath);
  const response = await fetch(blobUrl, { cache: "no-store" });

  if (!response.ok || !response.body) {
    return NextResponse.json({ error: "找不到游戏文件。" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=300");

  if (filePath.endsWith(".html")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' https: data: blob:",
        "media-src 'self' https: data: blob:",
        "font-src 'self' https: data:",
        "connect-src 'self' https:",
      ].join("; "),
    );
  }

  return new Response(response.body, { headers });
}
