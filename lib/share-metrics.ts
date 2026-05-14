import { prisma } from "@/lib/db";

const COUNTER_WINDOW_START = new Date("2000-01-01T00:00:00.000Z");

function gameShareKey(gameId: string) {
  return `game-share:${gameId}`;
}

export async function incrementGameShareCount(gameId: string) {
  const bucket = await prisma.usageBucket.upsert({
    where: {
      key_windowStart: {
        key: gameShareKey(gameId),
        windowStart: COUNTER_WINDOW_START,
      },
    },
    create: {
      key: gameShareKey(gameId),
      windowStart: COUNTER_WINDOW_START,
      count: 1,
    },
    update: {
      count: {
        increment: 1,
      },
    },
    select: {
      count: true,
    },
  });

  return bucket.count;
}

export async function listGameShareCounts(gameIds: string[]) {
  const uniqueGameIds = [...new Set(gameIds.filter(Boolean))];
  if (!uniqueGameIds.length) return {} as Record<string, number>;

  const buckets = await prisma.usageBucket.findMany({
    where: {
      windowStart: COUNTER_WINDOW_START,
      key: {
        in: uniqueGameIds.map(gameShareKey),
      },
    },
    select: {
      key: true,
      count: true,
    },
  });

  return Object.fromEntries(
    uniqueGameIds.map((gameId) => {
      const bucket = buckets.find((item) => item.key === gameShareKey(gameId));
      return [gameId, bucket?.count ?? 0];
    }),
  ) as Record<string, number>;
}

export async function getGameShareCount(gameId: string) {
  const counts = await listGameShareCounts([gameId]);
  return counts[gameId] ?? 0;
}
