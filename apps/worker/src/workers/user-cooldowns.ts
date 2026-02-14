import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  getPersonalApiKey,
  upsertUserCooldowns,
  type UserCooldownsData,
} from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_cooldowns_worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

// Get the single personalized user ID from environment or use a default UUID
const PERSONAL_USER_ID = process.env.SENTINEL_USER_ID || "f47ac10b-58cc-4372-a567-0e02b2c3d479";

async function syncUserCooldownsHandler(): Promise<void> {
  // Personalized bot mode: use single API key from environment
  let users: Array<{ user_id: string; api_key: string }>;
  
  try {
    const apiKey = getPersonalApiKey();
    users = [{ user_id: PERSONAL_USER_ID, api_key: apiKey }];
  } catch (error) {
    // Fall back to multi-user mode if TORN_API_KEY not set
    users = await getAllUsers();
    if (users.length === 0) {
      return;
    }
  }

  const updates: UserCooldownsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      // In personalized mode, API key is not encrypted; in multi-user mode, it is
      const apiKey = user.api_key.length === 16 
        ? user.api_key 
        : decrypt(user.api_key);
      const cooldownsResponse = await tornApi.get("/user/cooldowns", {
        apiKey,
      });
      const cooldowns = cooldownsResponse.cooldowns;

      if (!cooldowns) {
        throw new Error("Missing cooldowns in Torn response");
      }

      updates.push({
        user_id: user.user_id,
        drug: cooldowns.drug || 0,
        medical: cooldowns.medical || 0,
        booster: cooldowns.booster || 0,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `${user.user_id}: ${errorMessage}`);
    }
  }

  if (updates.length > 0) {
    await upsertUserCooldowns(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length}/${users.length} users failed`);
  }
}

export function startUserCooldownsWorker(): void {
  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    defaultCadenceSeconds: 30,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserCooldownsHandler,
      });
    },
  });
}
