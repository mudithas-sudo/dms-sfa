import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Pooled (PgBouncer) endpoints need these flags; the pool and timeouts keep a slow database wake-up from stalling a page for minutes.
function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.hostname.includes("-pooler")) url.searchParams.set("pgbouncer", "true");
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "6");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "15");
  return url.toString();
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient(databaseUrl() ? { datasources: { db: { url: databaseUrl() } } } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
