import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Load environment variables from local .env
dotenv.config();

/**
 * Global instance holder for PrismaClient to prevent multiple connections
 * during development hot-reloading.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "[SentinelDatabase] DATABASE_URL environment variable is not defined. Ensure .env contains DATABASE_URL.",
  );
}

const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Alias export for `prisma` instance for cleaner semantics (`db.user.findMany(...)`)
 */
export const db = prisma;

export * from "@prisma/client";
export * from "./boot-alert.js";

