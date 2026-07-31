import { db, type ApiKey } from "@sentinel/database";
import { ensureEnvLoaded } from "@sentinel/utils";
import {
  TornApiClient,
  decryptApiKey,
  type paths,
  type PathOperation,
  type OperationResponse,
  type OperationQueryParams,
  type OperationPathParams,
} from "@sentinel/torn-api";
import { UserRateLimiter } from "./user-rate-limiter.js";
import { UserCooldownManager } from "./user-cooldown.js";
import { KeyHealthManager } from "./key-health-manager.js";

export type StoredApiKey = {
  apiKey: string;
  userId: number;
  keyType: string;
};

let systemKeyIndex = 0;

/**
 * Fetches all active API keys (both system and personal) to form the full request pool.
 */
export async function getSystemKeyPool(): Promise<StoredApiKey[]> {
  ensureEnvLoaded();
  const masterKey = process.env.ENCRYPTION_KEY ?? "";
  const keysInDb = await db.apiKey.findMany({
    where: { isValid: true },
  });

  if (keysInDb.length > 0) {
    return keysInDb.map((k: ApiKey) => ({
      apiKey:
        k.apiKeyEncrypted.length > 16 && masterKey
          ? decryptApiKey(k.apiKeyEncrypted, masterKey)
          : k.apiKeyEncrypted,
      userId: k.userId,
      keyType: k.keyType,
    }));
  }

  const envKey = process.env.TORN_API_KEY;
  if (envKey) {
    return [{ apiKey: envKey, userId: 0, keyType: "system" }];
  }

  throw new Error("No valid API keys available in database or environment.");
}

/**
 * Gets the next system API key in a fair, persistent round-robin order across system requests.
 */
export async function getNextSystemKey(): Promise<StoredApiKey> {
  const keys = await getSystemKeyPool();
  if (keys.length === 0) {
    throw new Error("No API keys available in key pool.");
  }
  const key = keys[systemKeyIndex % keys.length];
  systemKeyIndex = (systemKeyIndex + 1) % keys.length;
  return key;
}

/**
 * Gets N system API keys in a fair round-robin order, advancing the global pointer per key.
 */
export async function getSystemKeys(count: number): Promise<StoredApiKey[]> {
  const pool = await getSystemKeyPool();
  if (pool.length === 0) {
    throw new Error("No API keys available in key pool.");
  }
  const selected: StoredApiKey[] = [];
  for (let i = 0; i < count; i++) {
    const key = pool[systemKeyIndex % pool.length];
    systemKeyIndex = (systemKeyIndex + 1) % pool.length;
    selected.push(key);
  }
  return selected;
}

/**
 * Returns the personal API key record for the repository owner (keyType === "personal").
 */
export async function getPersonalKey(): Promise<StoredApiKey | null> {
  ensureEnvLoaded();
  const masterKey = process.env.ENCRYPTION_KEY ?? "";

  const personalKey = await db.apiKey.findFirst({
    where: { keyType: "personal", isValid: true },
  });

  if (personalKey) {
    return {
      apiKey:
        personalKey.apiKeyEncrypted.length > 16 && masterKey
          ? decryptApiKey(personalKey.apiKeyEncrypted, masterKey)
          : personalKey.apiKeyEncrypted,
      userId: personalKey.userId,
      keyType: personalKey.keyType,
    };
  }

  return null;
}

/**
 * Configuration options for ManagedTornApiClient
 */
export type ManagedTornApiConfig = {
  maxRequestsPerWindow?: number;
  pepper?: string;
  encryptionKey?: string;
};

/**
 * Managed Torn API Client for Worker v2.
 * Integrates per-user rate-limiting, per-user cooldowns, key health tracking, and TornApiClient.
 */
export class ManagedTornApiClient {
  readonly rateLimiter: UserRateLimiter;
  readonly cooldownManager: UserCooldownManager;
  readonly keyHealthManager: KeyHealthManager;
  readonly client: TornApiClient;
  private encryptionKey: string;

  constructor(config: ManagedTornApiConfig = {}) {
    ensureEnvLoaded();
    this.rateLimiter = new UserRateLimiter(config.maxRequestsPerWindow ?? 50);
    this.cooldownManager = new UserCooldownManager();
    const pepper = config.pepper ?? process.env.API_KEY_HASH_PEPPER ?? "";
    this.encryptionKey =
      config.encryptionKey ?? process.env.ENCRYPTION_KEY ?? "";

    this.keyHealthManager = new KeyHealthManager(pepper);

    this.client = new TornApiClient({
      onInvalidKey: async (apiKey, errorCode) => {
        await this.keyHealthManager.handleInvalidKey(apiKey, errorCode);
      },
    });
  }

  /**
   * High-level managed GET request for OpenAPI v2 paths with per-user rate limiting & cooldown checking.
   */
  async get<P extends keyof paths>(
    path: P,
    options: {
      userId: number | string;
      apiKey: string;
      pathParams?: OperationPathParams<PathOperation<P>>;
      queryParams?: OperationQueryParams<PathOperation<P>>;
    },
  ): Promise<OperationResponse<PathOperation<P>>> {
    const { userId, apiKey, pathParams, queryParams } = options;

    await this.cooldownManager.waitIfInCooldown(userId);
    await this.rateLimiter.waitIfNeeded(userId);

    const decryptedKey =
      apiKey.length > 16
        ? decryptApiKey(apiKey, this.encryptionKey)
        : apiKey;

    const result = await this.client.get(path, {
      apiKey: decryptedKey,
      pathParams,
      queryParams,
    });

    await this.keyHealthManager.recordSuccessfulUse(decryptedKey);
    return result;
  }

  /**
   * Distributes batch requests in parallel across available API keys using fair round-robin.
   * Passes each request through per-user rate limiting.
   */
  async executeBatch<P extends keyof paths, Item>(
    path: P,
    items: Item[],
    keys?: StoredApiKey[],
    buildParams?: (item: Item) => {
      pathParams?: OperationPathParams<PathOperation<P>>;
      queryParams?: OperationQueryParams<PathOperation<P>>;
    },
  ): Promise<OperationResponse<PathOperation<P>>[]> {
    const keyPool =
      keys && keys.length > 0 ? keys : await getSystemKeyPool();
    if (keyPool.length === 0) {
      throw new Error("No API keys provided for batch execution.");
    }

    return Promise.all(
      items.map((item) => {
        const keyEntry = keyPool[systemKeyIndex % keyPool.length];
        systemKeyIndex = (systemKeyIndex + 1) % keyPool.length;
        const params = buildParams ? buildParams(item) : {};
        return this.get(path, {
          apiKey: keyEntry.apiKey,
          userId: keyEntry.userId,
          pathParams: params.pathParams,
          queryParams: params.queryParams,
        });
      }),
    );
  }
}

export const tornApiManager = new ManagedTornApiClient();
