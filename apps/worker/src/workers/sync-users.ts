import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import { getAllUsers, updateUserProfile } from "../lib/supabase.js";
import { fetchTornUserBasic } from "../services/torn.js";
import { log, logSuccess, logError, logWarn } from "../lib/logger.js";

const WORKER_NAME = "sync-users";

/**
 * Sync user data from Torn API and update local database.
 * - Fetches all user_keys from Supabase
 * - Decrypts API keys
 * - Calls Torn API for each key
 * - Upserts user_data with name and player_id
 */
async function syncUserDataHandler(): Promise<void> {
  // Fetch all users
  const users = await getAllUsers();
  log(WORKER_NAME, `Found ${users.length} users to sync`);

  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users to sync");
    return;
  }

  const updates: Array<{ user_id: string; name: string; player_id: number }> =
    [];
  const errors: Array<{ userId: string; error: string }> = [];

  // Process each user
  for (const user of users) {
    try {
      // Decrypt the API key
      const decryptedKey = decrypt(user.api_key);

      // Fetch user data from Torn API
      const tornData = await fetchTornUserBasic(decryptedKey);

      // Prepare update data
      updates.push({
        user_id: user.user_id,
        name: tornData.profile!.name,
        player_id: tornData.profile!.id,
      });

      log(
        WORKER_NAME,
        `Fetched data for ${tornData.profile!.name} [${tornData.profile!.id}]tornitem`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(
        WORKER_NAME,
        `Failed to sync user ${user.user_id}: ${errorMessage}`,
      );
    }
  }

  // Update successful syncs
  if (updates.length > 0) {
    await updateUserProfile(updates);
    logSuccess(WORKER_NAME, `Updated ${updates.length} user profiles`);
  }

  // Log errors if any
  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} users failed to sync`);
  }
}

/**
 * Initialize the user sync worker with hourly cron job.
 */
export function startUserSyncWorker(): void {
  log(WORKER_NAME, "Starting worker...");

  // Run every hour (0 minutes past every hour)
  const task = cron.schedule("0 * * * *", async () => {
    try {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000, // 30 second timeout
        handler: syncUserDataHandler,
      });
    } catch (error) {
      logError(WORKER_NAME, `Cron tick failed: ${error}`);
      // Continue on error, cron will retry next hour
    }
  });

  log(WORKER_NAME, "Scheduled: every hour (0 * * * *)");

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncUserDataHandler,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });

  return task as any;
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startUserSyncWorker();

  // Keep process alive
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
