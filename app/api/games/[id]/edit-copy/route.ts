import { NextResponse } from "next/server";
import { createEditableCopyFromPublicGame } from "@/lib/games";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
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
