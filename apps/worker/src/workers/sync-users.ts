import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import { getUserKeys, upsertUserData, type UserData } from "../lib/supabase.js";
import { fetchTornUserBasic } from "../services/torn.js";

/**
 * Sync user data from Torn API and update local database.
 * - Fetches all user_keys from Supabase
 * - Decrypts API keys
 * - Calls Torn API for each key
 * - Upserts user_data with name and player_id
 */
async function syncUserDataHandler(): Promise<void> {
  // Fetch all user keys
  const userKeys = await getUserKeys();
  console.log(`Found ${userKeys.length} user keys to sync`);

  if (userKeys.length === 0) {
    console.log("No user keys to sync");
    return;
  }

  const updates: UserData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  // Process each user key
  for (const userKey of userKeys) {
    try {
      // Decrypt the API key
      const decryptedKey = decrypt(userKey.api_key);

      // Fetch user data from Torn API
      const tornData = await fetchTornUserBasic(decryptedKey);

      // Prepare update data
      updates.push({
        user_id: userKey.user_id,
        name: tornData.profile!.name,
        player_id: tornData.profile!.id,
      });

      console.log(
        `Fetched data for user ${userKey.user_id}: ${tornData.profile!.name} (${tornData.profile!.id})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: userKey.user_id, error: errorMessage });
      console.error(`Failed to sync user ${userKey.user_id}:`, errorMessage);
    }
  }

  // Upsert successful updates
  if (updates.length > 0) {
    await upsertUserData(updates);
    console.log(`Upserted ${updates.length} user records`);
  }

  // Log errors if any
  if (errors.length > 0) {
    console.warn(`${errors.length} users failed to sync:`, errors);
  }
}

/**
 * Initialize the user sync worker with hourly cron job.
 */
export function startUserSyncWorker(): void {
  console.log("Starting user sync worker...");

  // Run every hour (0 minutes past every hour)
  const task = cron.schedule("0 * * * *", async () => {
    try {
      await executeSync({
        name: "sync-users",
        timeout: 30000, // 30 second timeout
        handler: syncUserDataHandler,
      });
    } catch (error) {
      console.error("User sync failed:", error);
      // Continue on error, cron will retry next hour
    }
  });

  console.log("User sync scheduled: every hour (0 * * * *)");

  // Optional: Run immediately on startup (comment out if not desired)
  console.log("Running initial sync...");
  executeSync({
    name: "sync-users",
    timeout: 30000,
    handler: syncUserDataHandler,
  }).catch((error) => {
    console.error("Initial sync failed:", error);
  });

  return task as any;
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startUserSyncWorker();

  // Keep process alive
  console.log("Worker running. Press Ctrl+C to exit.");
}
