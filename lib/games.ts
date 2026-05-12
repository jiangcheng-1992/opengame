import type { GameStatus, JobStatus, Message, Reaction, Role, Visibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAnonId, getExistingAnonId } from "@/lib/auth";
import { getBuiltinGame, listBuiltinGames } from "@/lib/builtin-games";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { toClientGame } from "@/lib/status";

const PINNED_HOME_GAME_ID = "builtin-starport-dash";

type SelectedJob = {
  id: string;
  status: JobStatus;
  errorMsg: string | null;
  createdAt: Date;
};

type SelectedMessage = Pick<Message, "id" | "gameId" | "role" | "content" | "jobId" | "createdAt">;
type SelectedReaction = Pick<Reaction, "id">;

type GameListRecord = {
  id: string;
  ownerId: string;
  title: string;
  summary: string | null;
  genre: string | null;
  tags: string[];
  controls: string[];
  coverUrl: string | null;
  status: GameStatus;
  visibility: Visibility;
  playUrl: string | null;
  playCount: number;
  likeCount: number;
  createdAt: Date;
  jobs: SelectedJob[];
  reactions?: SelectedReaction[];
};

type GameDetailRecord = GameListRecord & {
  sourceUrl: string | null;
  version: number;
  parentGameId: string | null;
  updatedAt: Date;
  messages: SelectedMessage[];
};

const mineStatusFilters = ["all", "active", "ready", "failed"] as const;

export type MineStatusFilter = (typeof mineStatusFilters)[number];

const mineStatusValues: Record<Exclude<MineStatusFilter, "all" | "active">, GameStatus[]> = {
  ready: ["READY"],
  failed: ["FAILED"],
};

export function normalizeMineStatusFilter(value?: string | null): MineStatusFilter {
  return mineStatusFilters.includes(value as MineStatusFilter) ? (value as MineStatusFilter) : "all";
}

export async function hasMineGames() {
  const anonId = await getAnonId();
  const game = await prisma.game.findFirst({
    where: { ownerId: anonId ?? "" },
    select: { id: true },
  });

  return Boolean(game);
}

function normalizeLatestJob(job?: SelectedJob | null) {
  return job
    ? {
        ...job,
        status: job.status.toLowerCase(),
      }
    : null;
}

function normalizeMessages(messages?: SelectedMessage[]) {
  return messages?.map((message) => ({
    ...message,
    role: message.role.toLowerCase() as Lowercase<Role>,
  }));
}

function toClientGameListItem(game: GameListRecord, viewerAnonId?: string) {
  return {
    ...game,
    playUrl: game.playUrl ? `/api/games/${game.id}/files/index.html` : null,
    blobPlayUrl: game.playUrl,
    status: game.status.toLowerCase(),
    visibility: game.visibility.toLowerCase(),
    ownedByMe: viewerAnonId ? game.ownerId === viewerAnonId : false,
    latestJob: normalizeLatestJob(game.jobs?.[0]),
    likedByMe: Boolean(game.reactions?.length),
    isBuiltin: false,
  };
}

function sortPublicHomeGames<T extends { id: string; createdAt: Date | string }>(games: T[]) {
  return [...games].sort((first, second) => {
    if (first.id === PINNED_HOME_GAME_ID) return -1;
    if (second.id === PINNED_HOME_GAME_ID) return 1;
    return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  });
}

function toClientGameDetail(game: GameDetailRecord, viewerAnonId: string) {
  return {
    ...game,
    playUrl: game.playUrl ? `/api/games/${game.id}/files/index.html` : null,
    blobPlayUrl: game.playUrl,
    status: game.status.toLowerCase(),
    visibility: game.visibility.toLowerCase(),
    ownedByMe: game.ownerId === viewerAnonId,
    latestJob: normalizeLatestJob(game.jobs?.[0]),
    messages: normalizeMessages(game.messages),
    likedByMe: Boolean(game.reactions?.length),
    isBuiltin: false,
  };
}

export async function listGames(tab: "all" | "mine", cursor?: string | null, mineStatus: MineStatusFilter = "all") {
  const builtinGames = tab === "all" && !cursor ? listBuiltinGames() : [];
  const statusValues = tab === "mine" && mineStatus !== "all" && mineStatus !== "active" ? mineStatusValues[mineStatus] : null;

  try {
    const anonId = tab === "mine" ? await getAnonId() : await getExistingAnonId();
    const games = await prisma.game.findMany({
      where:
        tab === "mine"
          ? {
              ownerId: anonId ?? "",
              ...(mineStatus === "active"
                ? { OR: [{ status: "DRAFT" }, { status: "GENERATING", playUrl: null }] }
                : statusValues
                  ? { status: { in: statusValues } }
                  : {}),
            }
          : { visibility: "PUBLIC", status: "READY" },
      orderBy: { createdAt: "desc" },
      take: 13,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        ownerId: true,
        title: true,
        summary: true,
        genre: true,
        tags: true,
        controls: true,
        coverUrl: true,
        status: true,
        visibility: true,
        playUrl: true,
        playCount: true,
        likeCount: true,
        createdAt: true,
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, errorMsg: true, createdAt: true },
        },
        ...(anonId ? { reactions: { where: { anonId, type: "LIKE" as const }, take: 1, select: { id: true } } } : {}),
      },
    });

    const visibleGames = games.slice(0, 12).map((game) => toClientGameListItem(game, anonId ?? undefined));
    const nextCursor = games.length > 12 ? visibleGames[visibleGames.length - 1]?.id ?? null : null;
    return {
      games: sortPublicHomeGames([...builtinGames, ...visibleGames]),
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
    select: {
      id: true,
      ownerId: true,
      title: true,
      summary: true,
      genre: true,
      tags: true,
      controls: true,
      coverUrl: true,
      status: true,
      visibility: true,
      playUrl: true,
      sourceUrl: true,
      version: true,
      parentGameId: true,
      playCount: true,
      likeCount: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 24,
        select: { id: true, gameId: true, role: true, content: true, jobId: true, createdAt: true },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, errorMsg: true, createdAt: true },
      },
      reactions: { where: { anonId, type: "LIKE" }, take: 1, select: { id: true } },
    },
  });

  if (!game) return null;
  if (game.visibility === "PRIVATE" && game.ownerId !== anonId) return null;

  return toClientGameDetail({ ...game, messages: [...game.messages].reverse() }, anonId);
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

  if (!game || game.ownerId !== anonId || !(game.status === "DRAFT" || (game.status === "GENERATING" && !game.playUrl))) return null;
  return toClientGame(game, anonId);
}

export function titleFromPrompt(prompt: string) {
  return fallbackGameMetadata(prompt).title;
}
