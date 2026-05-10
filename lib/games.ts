import { prisma } from "@/lib/db";
import { getAnonId, getExistingAnonId } from "@/lib/auth";
import { getBuiltinGame, listBuiltinGames } from "@/lib/builtin-games";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { toClientGame } from "@/lib/status";

export async function listGames(tab: "all" | "mine", cursor?: string | null) {
  const builtinGames = tab === "all" && !cursor ? listBuiltinGames() : [];

  try {
    const anonId = tab === "mine" ? await getAnonId() : await getExistingAnonId();
    const games = await prisma.game.findMany({
      where:
        tab === "mine"
          ? { ownerId: anonId ?? "" }
          : { visibility: "PUBLIC", status: { in: ["READY", "GENERATING", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 13,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        ...(anonId ? { reactions: { where: { anonId, type: "LIKE" as const } } } : {}),
      },
    });

    const nextCursor = games.length > 12 ? games[12].id : null;
    return {
      games: [...builtinGames, ...games.slice(0, 12).map((game) => toClientGame(game, anonId ?? undefined))],
      nextCursor,
    };
  } catch (error) {
    if (tab === "all") {
      return { games: builtinGames, nextCursor: null };
    }
    throw error;
  }
}

export async function getGameDetail(id: string) {
  const builtinGame = getBuiltinGame(id);
  if (builtinGame) return builtinGame;

  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      reactions: { where: { anonId, type: "LIKE" } },
    },
  });

  if (!game) return null;
  if (game.visibility === "PRIVATE" && game.ownerId !== anonId) return null;

  return toClientGame(game, anonId);
}

export async function getCreateDraft(id: string) {
  const anonId = await getAnonId();
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      reactions: { where: { anonId, type: "LIKE" } },
    },
  });

  if (!game || game.ownerId !== anonId || game.status !== "DRAFT") return null;
  return toClientGame(game, anonId);
}

export function titleFromPrompt(prompt: string) {
  return fallbackGameMetadata(prompt).title;
}
