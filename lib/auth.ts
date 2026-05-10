import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

export const ANON_COOKIE = "anon_id";
export const ANON_HEADER = "x-anon-id";

export async function getAnonId() {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  const anonId = jar.get(ANON_COOKIE)?.value ?? requestHeaders.get(ANON_HEADER) ?? crypto.randomUUID();

  await prisma.anonUser.upsert({
    where: { id: anonId },
    update: { lastSeen: new Date() },
    create: { id: anonId },
  });

  return anonId;
}

export function getClientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
