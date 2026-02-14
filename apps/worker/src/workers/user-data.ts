import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey, upsertUserData, type UserProfileData } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { log, logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";
const DISCORD_WORKER_KEY = "user_data_worker";
const DISCORD_SYNC_NAME = "user_data_worker";

// Personalized bot mode: single user ID from environment
const PERSONAL_USER_ID: string = (() => {
  const userId = process.env.SENTINEL_USER_ID;
  if (!userId) {
    throw new Error(
      "SENTINEL_USER_ID environment variable is required for personalized bot mode",
    );
  }
  return userId;
})();

async function syncUserDataHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  const updates: UserProfileData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  try {
    const profileResponse = await tornApi.get("/user/profile", { apiKey });
    const profile = profileResponse.profile;

    if (!profile?.id || !profile?.name) {
      throw new Error("Missing profile id or name in Torn response");
    }

    const isDonator =
      (profile.donator_status || "").toLowerCase() === "donator";

    updates.push({
      user_id: PERSONAL_USER_ID,
      player_id: profile.id,
      name: profile.name,
      is_donator: isDonator,
      profile_image: profile.image || null,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    errors.push({ userId: PERSONAL_USER_ID, error: errorMessage });
    logError(WORKER_NAME, `${PERSONAL_USER_ID}: ${errorMessage}`);
  }

  if (updates.length > 0) {
    await upsertUserData(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `Profile sync failed: ${errors[0]?.error}`);
  }
}

async function syncDiscordHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  // Only update if user_data row exists (avoid inserting null player_id)
  const { data: existingRow, error: existingError } = await supabase
    .from(TABLE_NAMES.USER_DATA)
    .select("user_id")
    .eq("user_id", PERSONAL_USER_ID)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Failed to fetch user_data row for discord sync: ${existingError.message}`,
    );
  }

  if (!existingRow) {
    // Skip discord sync if profile hasn't been synced yet
    return;
  }

  const updates: UserProfileData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  try {
    // Fetch discord data
    let discordId: string | null = null;
    try {
      const discordResponse = await tornApi.get("/user/discord", { apiKey });
      discordId = discordResponse.discord?.discord_id || null;
    } catch {
      // Discord link is optional, continue without it
      log(DISCORD_SYNC_NAME, `${PERSONAL_USER_ID}: No Discord linked`);
    }

    updates.push({
      user_id: PERSONAL_USER_ID,
      discord_id: discordId,
    } as UserProfileData);
  } catch (_error) {
    const errorMessage =
      _error instanceof Error ? _error.message : String(_error);
    errors.push({ userId: PERSONAL_USER_ID, error: errorMessage });
    logError(
      DISCORD_SYNC_NAME,
      `${PERSONAL_USER_ID}: Discord sync failed - ${errorMessage}`,
    );
  }

  if (updates.length > 0) {
    // Use UPDATE instead of upsert to avoid inserting rows with null player_id
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from(TABLE_NAMES.USER_DATA)
        .update({ discord_id: update.discord_id })
        .eq("user_id", update.user_id);

      if (updateError) {
        logError(
          DISCORD_SYNC_NAME,
          `Failed to update discord_id for ${update.user_id}: ${updateError.message}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    logWarn(
      DISCORD_SYNC_NAME,
      `Discord sync failed: ${errors[0]?.error}`,
    );
  }
}

export function startUserDataWorker(): void {
  // Hourly profile sync
  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    defaultCadenceSeconds: 3600, // 1 hour
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserDataHandler,
      });
    },
  });

  // Daily discord sync (separate worker)
  startDbScheduledRunner({
    worker: DISCORD_WORKER_KEY,
    defaultCadenceSeconds: 86400, // 24 hours
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: DISCORD_SYNC_NAME,
        timeout: 30000,
        handler: syncDiscordHandler,
      });
    },
  });
}
