import { cookies } from "next/headers";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export const ANON_COOKIE = "anon_id";
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const AUTH_COOKIE = "auth_session";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";

function anonCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: ANON_COOKIE_MAX_AGE,
    path: "/",
  };
}

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: "/",
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("base64url");
  return `pbkdf2_${PASSWORD_DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsText, salt, expected] = storedHash.split("$");
  if (algorithm !== `pbkdf2_${PASSWORD_DIGEST}` || !iterationsText || !salt || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;
  const actual = pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
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

export async function getCurrentAccount() {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { account: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    try {
      jar.delete(AUTH_COOKIE);
    } catch {
      // Server Components can read cookies but cannot mutate response cookies.
    }
    return null;
  }

  return session.account;
}

async function createAuthSession(accountId: string) {
  const jar = await cookies();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_COOKIE_MAX_AGE * 1000);
  await prisma.authSession.create({
    data: {
      accountId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });
  jar.set(AUTH_COOKIE, token, authCookieOptions());
}

async function attachCurrentAnonAssets(primaryAnonId: string, currentAnonId: string) {
  const jar = await cookies();
  await prisma.anonUser.upsert({
    where: { id: primaryAnonId },
    update: { lastSeen: new Date() },
    create: { id: primaryAnonId },
  });

  if (currentAnonId !== primaryAnonId) {
    const linkedAccount = await prisma.account.findUnique({
      where: { primaryAnonId: currentAnonId },
      select: { id: true },
    });
    if (linkedAccount) {
      jar.set(ANON_COOKIE, primaryAnonId, anonCookieOptions());
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.game.updateMany({
        where: { ownerId: currentAnonId },
        data: { ownerId: primaryAnonId },
      });

      const reactions = await tx.reaction.findMany({
        where: { anonId: currentAnonId },
        select: { gameId: true, type: true },
      });
      for (const reaction of reactions) {
        await tx.reaction.upsert({
          where: {
            gameId_anonId_type: {
              gameId: reaction.gameId,
              anonId: primaryAnonId,
              type: reaction.type,
            },
          },
          create: {
            gameId: reaction.gameId,
            anonId: primaryAnonId,
            type: reaction.type,
          },
          update: {},
        });
      }
      await tx.reaction.deleteMany({ where: { anonId: currentAnonId } });
    });
  }

  jar.set(ANON_COOKIE, primaryAnonId, anonCookieOptions());
}

export async function registerAccount({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName?: string | null;
}) {
  const normalizedEmail = normalizeEmail(email);
  const currentAnonId = await getAnonId();
  const linkedAccount = await prisma.account.findUnique({
    where: { primaryAnonId: currentAnonId },
    select: { id: true },
  });
  const primaryAnonId = linkedAccount ? randomUUID() : currentAnonId;
  if (linkedAccount) {
    await prisma.anonUser.create({ data: { id: primaryAnonId } });
  }
  const account = await prisma.account.create({
    data: {
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || normalizedEmail.split("@")[0] || "玩家",
      primaryAnonId,
    },
  });

  await attachCurrentAnonAssets(account.primaryAnonId, currentAnonId);
  await createAuthSession(account.id);
  return account;
}

export async function loginAccount({ email, password }: { email: string; password: string }) {
  const normalizedEmail = normalizeEmail(email);
  const currentAnonId = await getAnonId();
  const account = await prisma.account.findUnique({ where: { email: normalizedEmail } });
  if (!account || !verifyPassword(password, account.passwordHash)) return null;

  await attachCurrentAnonAssets(account.primaryAnonId, currentAnonId);
  await createAuthSession(account.id);
  return account;
}

export async function logoutAccount() {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (token) {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
  jar.delete(AUTH_COOKIE);
}

export async function requireAccount() {
  return getCurrentAccount();
}

export function getClientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
