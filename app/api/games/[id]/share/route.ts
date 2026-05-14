import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isBuiltinGameId } from "@/lib/builtin-games";
import { incrementGameShareCount } from "@/lib/share-metrics";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!isBuiltinGameId(id)) {
    const game = await prisma.game.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!game) {
      return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
    }
  }

  const count = await incrementGameShareCount(id);
  return NextResponse.json({ ok: true, count });
}
