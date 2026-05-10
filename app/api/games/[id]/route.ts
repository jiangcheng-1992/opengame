import { NextResponse } from "next/server";
import { getGameDetail } from "@/lib/games";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const game = await getGameDetail(id);

  if (!game) {
    return NextResponse.json({ error: "找不到这个游戏。" }, { status: 404 });
  }

  return NextResponse.json({ game });
}
