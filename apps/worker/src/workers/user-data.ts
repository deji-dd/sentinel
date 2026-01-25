import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertUserData,
  type UserProfileData,
} from "../lib/supabase.js";
import {
  fetchTornUserProfile,
  fetchTornUserDiscord,
} from "../services/torn.js";
import { log, logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";
const DISCORD_WORKER_KEY = "user_discord_worker";
const DISCORD_SYNC_NAME = "user_discord_worker";

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

async function syncDiscordHandler(): Promise<void> {
  const users = await getAllUsers();

  if (users.length === 0) {
    return;
  }

  // Only update users that already have user_data rows (avoid inserting null player_id)
  const userIds = users.map((u) => u.user_id);
  const { data: existingRows, error: existingError } = await supabase
    .from(TABLE_NAMES.USER_DATA)
    .select("user_id")
    .in("user_id", userIds);

  if (existingError) {
    throw new Error(
      `Failed to fetch user_data rows for discord sync: ${existingError.message}`,
    );
  }

  const existingUserIds = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existingRows || []).map((r: any) => r.user_id),
  );

  const updates: UserProfileData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    if (!existingUserIds.has(user.user_id)) {
      // Skip users without a profile row yet; the hourly profile sync will create them
      continue;
    }

    try {
      const apiKey = decrypt(user.api_key);

      // Fetch discord data
      let discordId: string | null = null;
      try {
        const discordResponse = await fetchTornUserDiscord(apiKey);
        discordId = discordResponse.discord?.discord_id || null;
      } catch {
        // Discord link is optional, continue without it
        log(DISCORD_SYNC_NAME, `${user.user_id}: No Discord linked`);
      }

      updates.push({
        user_id: user.user_id,
        discord_id: discordId,
      } as UserProfileData);
    } catch (_error) {
      const errorMessage =
        _error instanceof Error ? _error.message : String(_error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(
        DISCORD_SYNC_NAME,
        `${user.user_id}: Discord sync failed - ${errorMessage}`,
      );
    }
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
      `Discord sync: ${errors.length}/${users.length} users failed`,
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
