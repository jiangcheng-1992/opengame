import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId } from "@/lib/auth";
import { isBuiltinGameId } from "@/lib/builtin-games";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (isBuiltinGameId(id)) {
    return NextResponse.json({ liked: true, localOnly: true });
  }

  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({ where: { id }, select: { id: true } });
  if (!game) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  const existing = await prisma.reaction.findUnique({
    where: { gameId_anonId_type: { gameId: id, anonId, type: "LIKE" } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.reaction.delete({ where: { id: existing.id } }),
      prisma.game.updateMany({ where: { id, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return NextResponse.json({ liked: false });
  }

  await prisma.$transaction([
    prisma.reaction.create({ data: { gameId: id, anonId, type: "LIKE" } }),
    prisma.game.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
  ]);
  return NextResponse.json({ liked: true });
}
