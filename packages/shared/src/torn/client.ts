import { randomUUID } from "crypto";
import { TornApiClient, ApiKeyRotator } from "./torn.js";
import { hashApiKey, decryptApiKey } from "./api-key-manager.js";
import { Logger } from "../utils/logger.js";

// Note: Adjust these relative imports based on exactly where your NoSQL schema
// instances (SystemApiKeys, etc.) are located inside your shared package.
import { SystemApiKeys, ApiKeyMappings, RateLimits } from "../index.js";

const logger = new Logger("Torn_Unified_Client");

const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;

if (!API_KEY_HASH_PEPPER || !ENCRYPTION_KEY) {
  throw new Error(
    "CRITICAL: API_KEY_HASH_PEPPER and ENCRYPTION_KEY must be set in environment.",
  );
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 50;

// High-performance RAM cache for rate limiting
const ramMap = new Map<string, number[]>();
let lastCleanupAt = 0;

/**
 * Initializes the RAM cache by pulling recent requests from the NoSQL engine.
 * Should be called once upon application boot (Worker/Bot).
 */
export function initializeRateLimitCache(): void {
  const windowStart = Date.now() - WINDOW_MS;

  // NoSQL findAll is completely synchronous and non-blocking in RAM
  const recentRequests = RateLimits.findAll(
    (doc: any) => doc.requested_at >= windowStart,
  );

  for (const req of recentRequests) {
    const existing = ramMap.get(req.api_key_hash) || [];
    existing.push(req.requested_at);
    existing.sort((a, b) => a - b);
    ramMap.set(req.api_key_hash, existing);
  }

  logger.info(
    `Initialized RAM cache with ${recentRequests.length} active records.`,
  );
}

/**
 * Custom Rate Limiter integrating NoSQL write-behind and RAM caching.
 * Protects GCP Free Tier RAM while perfectly syncing across app reboots.
 */
class UnifiedRateLimiter {
  async waitIfNeeded(apiKey: string): Promise<void> {
    const now = Date.now();
    if (now - lastCleanupAt >= 30_000) {
      lastCleanupAt = now;
      this.cleanupOldRequests();
    }

    const keyHash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

    while (true) {
      const timestamps = ramMap.get(keyHash) || [];
      const active = timestamps.filter((t) => t >= Date.now() - WINDOW_MS);

      if (active.length < MAX_REQUESTS_PER_WINDOW) {
        await this.recordRequest(apiKey, keyHash);
        return;
      }

      const oldest = active[0];
      const waitTime = WINDOW_MS - (Date.now() - oldest) + 100;

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
    }
  }

  async recordRequest(apiKey: string, predefinedHash?: string): Promise<void> {
    const keyHash = predefinedHash || hashApiKey(apiKey, API_KEY_HASH_PEPPER);
    const now = Date.now();

    // 1. Instantly lock RAM
    const timestamps = ramMap.get(keyHash) || [];
    timestamps.push(now);
    ramMap.set(keyHash, timestamps);

    // 2. Non-blocking write-behind to SQLite via NoSQL wrapper
    const mapping = ApiKeyMappings.find(
      (doc: any) => doc.api_key_hash === keyHash,
    )[0];

    RateLimits.insertOne({
      id: randomUUID(),
      api_key_hash: keyHash,
      requested_at: now,
      user_id: mapping?.user_id || null,
    });
  }

  private cleanupOldRequests() {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Clean RAM
    for (const [keyHash, timestamps] of ramMap.entries()) {
      const active = timestamps.filter((t) => t >= windowStart);
      if (active.length === 0) ramMap.delete(keyHash);
      else ramMap.set(keyHash, active);
    }

    // Clean SQLite
    const staleDocs = RateLimits.findAll(
      (doc: any) => doc.requested_at < windowStart,
    );
    for (const doc of staleDocs) {
      RateLimits.delete(doc.id);
    }
  }
}

const rateLimiter = new UnifiedRateLimiter();

/**
 * Marks a key invalid upon Error Code 2. Soft-deletes if threshold (3) is reached.
 */
async function markApiKeyInvalid(apiKey: string): Promise<void> {
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);
  const mapping = ApiKeyMappings.find(
    (doc: any) => doc.api_key_hash === hash,
  )[0];
  if (!mapping) return;

  const userKeys = SystemApiKeys.find(
    (doc: any) => doc.user_id === mapping.user_id,
  );

  for (const key of userKeys) {
    const decrypted = decryptApiKey(key.api_key_encrypted, ENCRYPTION_KEY);
    if (decrypted === apiKey) {
      key.invalid_count = (key.invalid_count || 0) + 1;
      key.last_invalid_at = Date.now();

      if (key.invalid_count >= 3) {
        logger.warn(
          `System API key reached 3 invalid attempts, hard-deleting.`,
        );
        SystemApiKeys.delete(key.id);
        ApiKeyMappings.delete(mapping.id);
      } else {
        SystemApiKeys.insertOne(key);
      }
      break;
    }
  }
}

/**
 * The Globally Unified Torn API client instance.
 * Both the Bot and Worker should import this exact instance.
 */
export const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter as any,
  onInvalidKey: async (apiKey: string, errorCode: number) => {
    if (errorCode === 2) {
      await markApiKeyInvalid(apiKey);
    }
  },
});

/**
 * Verifies API keys are mapped to a user. Fetches from Torn API if missing.
 */
async function ensureApiKeyMapped(apiKey: string): Promise<number | null> {
  const hash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);
  const existing = ApiKeyMappings.find(
    (doc: any) => doc.api_key_hash === hash,
  )[0];
  if (existing) return existing.user_id;

  try {
    const client = new TornApiClient();
    const data = await client.get("/user/basic", { apiKey });
    const userId = data.profile?.id;

    if (userId) {
      ApiKeyMappings.insertOne({
        id: randomUUID(),
        api_key_hash: hash,
        user_id: userId,
        source: "system",
      });
      return userId;
    }
  } catch (err) {
    logger.warn(`Failed to map key: ${err}`);
  }
  return null;
}

/**
 * Initializes the worker API keys based on the requested operational scope.
 */
export async function initializeApiKeyMappings(): Promise<number[]> {
  const keysToMap: string[] = [];

  const envKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
  if (envKey) keysToMap.push(envKey);

  const dbKeys = SystemApiKeys.find((doc: any) => doc.key_type === "system");
  for (const doc of dbKeys) {
    keysToMap.push(decryptApiKey(doc.api_key_encrypted, ENCRYPTION_KEY));
  }

  const uniqueKeys = Array.from(new Set(keysToMap));
  if (!uniqueKeys.length) throw new Error("[CRITICAL] No API keys available.");

  logger.info(`Verifying mappings for ${uniqueKeys.length} API keys...`);

  const mappedIds: number[] = [];
  for (const key of uniqueKeys) {
    const id = await ensureApiKeyMapped(key);
    if (id) mappedIds.push(id);
    else throw new Error("[CRITICAL] Failed to map API key to user.");
  }

  // Cast rateLimiter as any to access private method, or make it public if preferred
  (rateLimiter as any).cleanupOldRequests();
  return mappedIds;
}

let systemKeyIndex = 0;

/**
 * Retrieves the entire pool of decrypted system API keys.
 * Use this when feeding keys into batch handlers.
 */
export function getSystemKeyPool(): string[] {
  const keyDocs = SystemApiKeys.find((doc: any) => doc.key_type === "system");

  if (keyDocs.length === 0) {
    throw new Error("[CRITICAL] No system API keys found in the database.");
  }

  return keyDocs.map((doc: any) =>
    decryptApiKey(doc.api_key_encrypted, ENCRYPTION_KEY),
  );
}

/**
 * Retrieves a single plaintext API key for standard worker operations.
 */
export function getWorkerApiKey(
  type: "personal" | "system" = "personal",
): string {
  if (type === "personal") {
    const personalKey =
      process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
    if (!personalKey) {
      throw new Error(
        "[CRITICAL] No personal API key found in environment variables.",
      );
    }
    return personalKey;
  }

  const pool = getSystemKeyPool();
  const selectedKey = pool[systemKeyIndex % pool.length];
  systemKeyIndex++;
  return selectedKey;
}

export { ApiKeyRotator };
