import { createHash, randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";

const TRACKER_TABLE = TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER;
const API_KEY_USER_MAPPING_TABLE = TABLE_NAMES.API_KEY_USER_MAPPING;
const WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 50;

async function getMappedUserIdByApiKeyHash(keyHash: string): Promise<number> {
  const row = await db
    .selectFrom(API_KEY_USER_MAPPING_TABLE)
    .select(["user_id"])
    .where("api_key_hash", "=", keyHash)
    .limit(1)
    .executeTakeFirst();

  const parsed = Number(row?.user_id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function hashApiKey(apiKey: string): string {
  const pepper = process.env.API_KEY_HASH_PEPPER;
  if (!pepper) {
    throw new Error(
      "API_KEY_HASH_PEPPER environment variable is required for secure rate limiting",
    );
  }

  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

export async function recordRequestPerUser(apiKey: string): Promise<void> {
  const keyHash = hashApiKey(apiKey);
  const now = new Date().toISOString();
  const userId = await getMappedUserIdByApiKeyHash(keyHash);

  await db
    .insertInto(TRACKER_TABLE)
    .values({ id: randomUUID(), api_key_hash: keyHash, requested_at: now, user_id: userId })
    .execute();
}

export async function getRequestCountPerUser(apiKey: string): Promise<number> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const row = await db
    .selectFrom(TRACKER_TABLE)
    .select((eb) => eb.fn.count("id").as("count"))
    .where("api_key_hash", "=", keyHash)
    .where("requested_at", ">=", windowStart)
    .executeTakeFirst();

  return Number(row?.count ?? 0);
}

export async function getOldestRequestPerUser(
  apiKey: string,
): Promise<Date | null> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const row = await db
    .selectFrom(TRACKER_TABLE)
    .select(["requested_at"])
    .where("api_key_hash", "=", keyHash)
    .where("requested_at", ">=", windowStart)
    .orderBy("requested_at", "asc")
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return new Date(row.requested_at);
}

export async function cleanupOldRequestsPerUser(): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  await db
    .deleteFrom(TRACKER_TABLE)
    .where("requested_at", "<", windowStart)
    .execute();
}

export async function isRateLimitedPerUser(apiKey: string): Promise<boolean> {
  const count = await getRequestCountPerUser(apiKey);
  return count >= MAX_REQUESTS_PER_WINDOW;
}
