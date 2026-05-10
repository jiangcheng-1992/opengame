import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const ANON_COOKIE = "anon_id";
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function anonCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: ANON_COOKIE_MAX_AGE,
    path: "/",
  };
}

export async function getExistingAnonId() {
  const jar = await cookies();
  return jar.get(ANON_COOKIE)?.value ?? null;
}

export async function getAnonId() {
  const jar = await cookies();
  const existingAnonId = jar.get(ANON_COOKIE)?.value;
  const anonId = existingAnonId ?? crypto.randomUUID();

  if (!existingAnonId) {
    try {
      jar.set(ANON_COOKIE, anonId, anonCookieOptions());
    } catch {
      // Server Components can read cookies but cannot mutate response cookies.
    }
  }

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
