import { createHash } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

const TRACKER_TABLE = TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER;
const WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 50;

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

  const db = getDB();
  db.prepare(
    `INSERT INTO "${TRACKER_TABLE}" (api_key_hash, requested_at) VALUES (?, ?)`,
  ).run(keyHash, now);
}

export async function getRequestCountPerUser(apiKey: string): Promise<number> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const db = getDB();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM "${TRACKER_TABLE}" WHERE api_key_hash = ? AND requested_at >= ?`,
    )
    .get(keyHash, windowStart) as { count: number };

  return row.count || 0;
}

export async function getOldestRequestPerUser(
  apiKey: string,
): Promise<Date | null> {
  const keyHash = hashApiKey(apiKey);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const db = getDB();
  const row = db
    .prepare(
      `SELECT requested_at FROM "${TRACKER_TABLE}" WHERE api_key_hash = ? AND requested_at >= ? ORDER BY requested_at ASC LIMIT 1`,
    )
    .get(keyHash, windowStart) as { requested_at: string } | undefined;

  if (!row) {
    return null;
  }

  return new Date(row.requested_at);
}

export async function cleanupOldRequestsPerUser(): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const db = getDB();
  db.prepare(`DELETE FROM "${TRACKER_TABLE}" WHERE requested_at < ?`).run(
    windowStart,
  );
}

export async function isRateLimitedPerUser(apiKey: string): Promise<boolean> {
  const count = await getRequestCountPerUser(apiKey);
  return count >= MAX_REQUESTS_PER_WINDOW;
}
