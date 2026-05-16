import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { createEditableCopyFromPublicGame } from "@/lib/games";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  if (!account) {
    return NextResponse.json({ error: "请先登录后再创建可编辑副本。" }, { status: 401 });
  }
  const { id } = await context.params;
  const result = await createEditableCopyFromPublicGame(id);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    gameId: result.gameId,
    href: `/games/${result.gameId}/edit`,
    alreadyOwned: result.alreadyOwned,
  });
}
