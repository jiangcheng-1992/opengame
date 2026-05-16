import type { Game, Job, Message, Reaction } from "@prisma/client";
import { builtinPublicFilePath, parseBuiltinCopyPlayUrl } from "@/lib/builtin-games";

export function toClientGame(
  game: Game & {
    jobs?: Job[];
    messages?: Message[];
    reactions?: Reaction[];
  },
  viewerAnonId?: string,
) {
  const builtinSlug = parseBuiltinCopyPlayUrl(game.playUrl);
  const playUrl = builtinSlug
    ? builtinPublicFilePath(builtinSlug)
    : game.playUrl
      ? `/api/games/${game.id}/files/index.html`
      : null;

  return {
    ...game,
    playUrl,
    blobPlayUrl: game.playUrl,
    status: game.status.toLowerCase(),
    visibility: game.visibility.toLowerCase(),
    contentType: game.contentType.toLowerCase(),
    ownedByMe: viewerAnonId ? game.ownerId === viewerAnonId : false,
    latestJob: game.jobs?.[0]
      ? {
          ...game.jobs[0],
          status: game.jobs[0].status.toLowerCase(),
        }
      : null,
    messages: game.messages?.map((message) => ({
      ...message,
      role: message.role.toLowerCase(),
    })),
    likedByMe: Boolean(game.reactions?.length),
    isBuiltin: false,
  };
}

export function tailLines(value: string, count: number) {
  return value.split(/\r?\n/).slice(-count).join("\n");
}
