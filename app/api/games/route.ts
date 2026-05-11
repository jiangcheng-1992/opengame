import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId } from "@/lib/auth";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { createGameSchema } from "@/lib/schemas";
import { listGames, normalizeMineStatusFilter } from "@/lib/games";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") === "mine" ? "mine" : "all";
  const cursor = searchParams.get("cursor");
  const payload = await listGames(tab, cursor, normalizeMineStatusFilter(searchParams.get("status")));
  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  const anonId = await getAnonId();
  const parsed = createGameSchema.safeParse(await req.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const metadata = fallbackGameMetadata(parsed.data.prompt);
  const game = await prisma.game.create({
    data: {
      ownerId: anonId,
      title: metadata.title,
      summary: metadata.summary,
      genre: metadata.genre,
      tags: metadata.tags,
      controls: metadata.controls,
      coverPrompt: metadata.coverPrompt,
      visibility: parsed.data.visibility,
      status: "DRAFT",
      messages: {
        create: {
          role: "USER",
          content: parsed.data.prompt,
        },
      },
    },
  });

  return NextResponse.json({ gameId: game.id, draft: true });
}
