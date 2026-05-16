import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAnonId, requireAccount } from "@/lib/auth";
import { createDraftSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  const account = await requireAccount();
  if (!account) {
    return NextResponse.json({ error: "请先登录后再创建游戏。" }, { status: 401 });
  }
  const anonId = await getAnonId();
  const parsed = createDraftSchema.safeParse(await req.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const game = await prisma.game.create({
    data: {
      ownerId: anonId,
      title: "创作草稿",
      summary: "对话头脑风暴中，确认需求后再生成可玩版本。",
      visibility: parsed.data.visibility,
      contentType: parsed.data.contentType,
      status: "DRAFT",
    },
  });

  return NextResponse.json({ gameId: game.id });
}
