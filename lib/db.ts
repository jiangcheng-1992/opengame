import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function stabilizeLocalNeonUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production" || !databaseUrl) return;

  try {
    const url = new URL(databaseUrl);
    if (!url.hostname.endsWith(".neon.tech")) return;
    url.searchParams.set("connect_timeout", url.searchParams.get("connect_timeout") ?? "30");
    url.searchParams.set("pool_timeout", url.searchParams.get("pool_timeout") ?? "30");
    url.searchParams.set("connection_limit", url.searchParams.get("connection_limit") ?? "1");
    process.env.DATABASE_URL = url.toString();
  } catch {
    // Keep the original value so Prisma can surface the real configuration error.
  }
}

stabilizeLocalNeonUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
