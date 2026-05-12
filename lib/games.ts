import type { GameStatus, JobStatus, Message, Reaction, Role, Visibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAnonId, getExistingAnonId } from "@/lib/auth";
import {
  builtinPublicFilePath,
  getBuiltinGame,
  isBuiltinGameId,
  listBuiltinGames,
  toBuiltinCopyPlayUrl,
} from "@/lib/builtin-games";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { toClientGame } from "@/lib/status";

const PINNED_HOME_GAME_ID = "builtin-starport-dash";

type SelectedJob = {
  id: string;
  status: JobStatus;
  errorMsg: string | null;
  modelKey: string;
  skeletonKey: string;
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

function clientPlayUrl(gameId: string, playUrl: string | null) {
  if (!playUrl) return null;
  if (playUrl.startsWith("builtin://")) {
    const slug = playUrl.slice("builtin://".length).trim();
    return slug ? builtinPublicFilePath(slug) : null;
  }
  return `/api/games/${gameId}/files/index.html`;
}

function toClientGameListItem(game: GameListRecord, viewerAnonId?: string) {
  return {
    ...game,
    playUrl: clientPlayUrl(game.id, game.playUrl),
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
    playUrl: clientPlayUrl(game.id, game.playUrl),
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
          select: { id: true, status: true, errorMsg: true, modelKey: true, skeletonKey: true, createdAt: true },
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
        select: { id: true, status: true, errorMsg: true, modelKey: true, skeletonKey: true, createdAt: true },
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

function editableCopyTitle(title: string) {
  const text = title.trim() || "未命名游戏";
  if (text.endsWith("同款")) return text;
  const chars = Array.from(text);
  return `${chars.slice(0, 18).join("")}同款`;
}

export async function createEditableCopyFromPublicGame(id: string) {
  const anonId = await getAnonId();
  const builtinGame = isBuiltinGameId(id) ? getBuiltinGame(id) : null;

  if (builtinGame) {
    const editableCopy = await prisma.$transaction(async (tx) => {
      const game = await tx.game.create({
        data: {
          ownerId: anonId,
          title: editableCopyTitle(builtinGame.title),
          summary: builtinGame.summary,
          genre: builtinGame.genre,
          tags: builtinGame.tags,
          controls: builtinGame.controls,
          coverPrompt: builtinGame.coverPrompt,
          coverUrl: builtinGame.coverUrl,
          status: "READY",
          visibility: "PRIVATE",
          playUrl: toBuiltinCopyPlayUrl(builtinGame.id.replace(/^builtin-/, "")),
          sourceUrl: null,
          version: 1,
        },
      });

      await tx.message.createMany({
        data: [
          {
            gameId: game.id,
            role: "SYSTEM",
            content: `这个可编辑副本基于内置精选《${builtinGame.title}》创建。它保留模板玩法和演示结构，后续通过对话继续做成你的版本。`,
          },
          {
            gameId: game.id,
            role: "SYSTEM",
            content: `内置模板基础 brief:\n${builtinGame.messages?.[0]?.content ?? builtinGame.summary}`,
          },
        ],
      });

      return game;
    });

    return { gameId: editableCopy.id, alreadyOwned: false as const };
  }

  const sourceGame = await prisma.game.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      title: true,
      summary: true,
      genre: true,
      tags: true,
      controls: true,
      coverPrompt: true,
      coverUrl: true,
      status: true,
      visibility: true,
      playUrl: true,
      sourceUrl: true,
      version: true,
    },
  });

  if (!sourceGame) {
    return { error: "找不到这个游戏。", status: 404 as const };
  }

  if (sourceGame.ownerId === anonId) {
    return { gameId: sourceGame.id, alreadyOwned: true as const };
  }

  if (sourceGame.visibility !== "PUBLIC" || sourceGame.status !== "READY" || !sourceGame.playUrl) {
    return { error: "只有公共可玩的作品才能创建同款副本。", status: 409 as const };
  }

  const editableCopy = await prisma.$transaction(async (tx) => {
    const game = await tx.game.create({
      data: {
        ownerId: anonId,
        title: editableCopyTitle(sourceGame.title),
        summary: sourceGame.summary,
        genre: sourceGame.genre,
        tags: sourceGame.tags,
        controls: sourceGame.controls,
        coverPrompt: sourceGame.coverPrompt,
        coverUrl: sourceGame.coverUrl,
        status: "READY",
        visibility: "PRIVATE",
        playUrl: sourceGame.playUrl,
        sourceUrl: sourceGame.sourceUrl,
        version: sourceGame.version,
        parentGameId: sourceGame.id,
      },
    });

    await tx.message.create({
      data: {
        gameId: game.id,
        role: "SYSTEM",
        content: `这个可编辑副本基于公共作品《${sourceGame.title}》创建。默认保留原始核心玩法、操作和视觉结构，除非后续用户明确要求修改。`,
      },
    });

    return game;
  });

  return { gameId: editableCopy.id, alreadyOwned: false as const };
}

export function titleFromPrompt(prompt: string) {
  return fallbackGameMetadata(prompt).title;
}
