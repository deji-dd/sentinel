import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertUserBars,
  type UserBarsData,
} from "../lib/supabase.js";
import { fetchTornUserBars } from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user-bars-worker";
const DB_WORKER_KEY = "user_bars_worker";

async function syncUserBarsHandler(): Promise<void> {
  const users = await getAllUsers();
  log(WORKER_NAME, `Syncing user bars for ${users.length} users`);

  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users to sync");
    return;
  }

  const updates: UserBarsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);
      const barsResponse = await fetchTornUserBars(apiKey);
      const bars = barsResponse.bars;

      if (!bars) {
        throw new Error("Missing bars in Torn response");
      }

      updates.push({
        user_id: user.user_id,
        energy_current: bars.energy?.current || 0,
        energy_maximum: bars.energy?.maximum || 0,
        nerve_current: bars.nerve?.current || 0,
        nerve_maximum: bars.nerve?.maximum || 0,
        happy_current: bars.happy?.current || 0,
        happy_maximum: bars.happy?.maximum || 0,
        life_current: bars.life?.current || 0,
        life_maximum: bars.life?.maximum || 0,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `Failed for user ${user.user_id}: ${errorMessage}`);
    }
  }

  if (updates.length > 0) {
    await upsertUserBars(updates);
    logSuccess(WORKER_NAME, `Updated ${updates.length} user bar records`);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} users failed to sync`);
  }
}

export function startUserBarsWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserBarsHandler,
      });
    },
  });

  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncUserBarsHandler,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startUserBarsWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
