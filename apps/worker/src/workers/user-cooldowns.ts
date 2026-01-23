import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertUserCooldowns,
  type UserCooldownsData,
} from "../lib/supabase.js";
import { fetchTornUserCooldowns } from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user-cooldowns-worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

async function syncUserCooldownsHandler(): Promise<void> {
  const users = await getAllUsers();
  log(WORKER_NAME, `Syncing user cooldowns for ${users.length} users`);

  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users to sync");
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
      logError(WORKER_NAME, `Failed for user ${user.user_id}: ${errorMessage}`);
    }
  }

  if (updates.length > 0) {
    await upsertUserCooldowns(updates);
    logSuccess(WORKER_NAME, `Updated ${updates.length} user cooldown records`);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} users failed to sync`);
  }
}

export function startUserCooldownsWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserCooldownsHandler,
      });
    },
  });

  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncUserCooldownsHandler,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startUserCooldownsWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
