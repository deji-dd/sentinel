import dotenv from "dotenv";
import { PrismaClient } from "../prisma/generated/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

try {
  dotenv.config();
} catch {}

/**
 * Global instance holder for PrismaClient to prevent multiple connections
 * during development hot-reloading.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;
const adapter = connectionString
  ? new PrismaPg({ connectionString })
  : undefined;

export const prisma =
  globalForPrisma.prisma ??
  (connectionString
    ? new PrismaClient({
        adapter,
        log:
          process.env.PRISMA_LOG_QUERIES === "true"
            ? ["query", "error", "warn"]
            : ["error", "warn"],
      })
    : new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Alias export for `prisma` instance for cleaner semantics (`db.user.findMany(...)`)
 */
export const db = prisma;

export type { ApiKey } from "@prisma/client";
export * from "@prisma/client";
export * from "./boot-alert.js";
