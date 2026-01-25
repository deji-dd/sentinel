import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertUserCooldowns,
  type UserCooldownsData,
} from "../lib/supabase.js";
import { fetchTornUserCooldowns } from "../services/torn.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_cooldowns_worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

async function syncUserCooldownsHandler(): Promise<void> {
  const users = await getAllUsers();

  if (users.length === 0) {
    return;
  }

  const updates: UserCooldownsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);
      const cooldownsResponse = await fetchTornUserCooldowns(apiKey);
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
