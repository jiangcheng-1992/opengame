import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isBuiltinGameId } from "@/lib/builtin-games";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (isBuiltinGameId(id)) {
    return NextResponse.json({ ok: true, localOnly: true });
  }

  const result = await prisma.game.updateMany({
    where: { id, status: "READY" },
    data: { playCount: { increment: 1 } },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
