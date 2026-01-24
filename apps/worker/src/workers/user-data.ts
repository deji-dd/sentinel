import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertUserData,
  type UserProfileData,
} from "../lib/supabase.js";
import { fetchTornUserProfile } from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";

async function syncUserDataHandler(): Promise<void> {
  const users = await getAllUsers();

  if (users.length === 0) {
    return;
  }

  const updates: UserProfileData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);
      const profileResponse = await fetchTornUserProfile(apiKey);
      const profile = profileResponse.profile;

      if (!profile?.id || !profile?.name) {
        throw new Error("Missing profile id or name in Torn response");
      }

      const isDonator =
        (profile.donator_status || "").toLowerCase() === "donator";

      updates.push({
        user_id: user.user_id,
        player_id: profile.id,
        name: profile.name,
        is_donator: isDonator,
        profile_image: profile.image || null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `${user.user_id}: ${errorMessage}`);
    }
  }

  if (updates.length > 0) {
    await upsertUserData(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length}/${users.length} users failed`);
  }
}

export function startUserDataWorker(): void {
  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserDataHandler,
      });
    },
  });
}
