import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId } from "@/lib/auth";
import { getGameDetail } from "@/lib/games";
import { updateVisibilitySchema } from "@/lib/schemas";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const game = await getGameDetail(id);

  if (!game) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  return NextResponse.json({ game });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      status: true,
      playUrl: true,
    },
  });

  if (!game || game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  const hasPlayableVersion = Boolean(game.playUrl);
  const canUseEditWorkbench = game.status === "READY" || game.status === "FAILED" || (game.status === "GENERATING" && hasPlayableVersion);
  if (!canUseEditWorkbench) {
    return NextResponse.json({ error: "游戏生成完成或失败后才能调整公开状态。" }, { status: 409 });
  }

  const parsed = updateVisibilitySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updatedGame = await prisma.game.update({
    where: { id: game.id },
    data: { visibility: parsed.data.visibility },
    select: { id: true, visibility: true },
  });

  return NextResponse.json({ game: { ...updatedGame, visibility: updatedGame.visibility.toLowerCase() } });
}
