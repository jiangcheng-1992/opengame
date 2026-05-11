import { prisma } from "@/lib/db";

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function incrementBucket(key: string, limit: number) {
  const windowStart = startOfUtcDay();
  const bucket = await prisma.usageBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (bucket.count > limit) {
    throw new Error("RATE_LIMITED");
  }
}

export async function enforceGenerationLimit(anonId: string, ip: string) {
  await incrementBucket(`anon:${anonId}`, 50);
  await incrementBucket(`ip:${ip}`, 100);
}
