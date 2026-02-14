import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { log, logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";
const DISCORD_WORKER_KEY = "user_data_worker";
const DISCORD_SYNC_NAME = "user_data_worker";

async function syncUserDataHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  try {
    const profileResponse = await tornApi.get("/user/profile", { apiKey });
    const profile = profileResponse.profile;

    if (!profile?.id || !profile?.name) {
      throw new Error("Missing profile id or name in Torn response");
    }

    const isDonator =
      (profile.donator_status || "").toLowerCase() === "donator";

    // Personalized mode: single-row upsert (id = 1)
    const { error } = await supabase
      .from(TABLE_NAMES.USER_DATA)
      .upsert(
        {
          id: 1,
          player_id: profile.id,
          name: profile.name,
          is_donator: isDonator,
          profile_image: profile.image || null,
        },
        { onConflict: "id" },
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Profile sync failed: ${errorMessage}`);
  }
}

async function syncDiscordHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  try {
    // Fetch discord data
    let discordId: string | null = null;
    try {
      const discordResponse = await tornApi.get("/user/discord", { apiKey });
      discordId = discordResponse.discord?.discord_id || null;
    } catch {
      // Discord link is optional, continue without it
      log(DISCORD_SYNC_NAME, "No Discord linked");
    }

    // Personalized mode: single-row update (id = 1)
    const { error } = await supabase
      .from(TABLE_NAMES.USER_DATA)
      .update({ discord_id: discordId })
      .eq("id", 1);

    if (error) {
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(DISCORD_SYNC_NAME, `Discord sync failed - ${errorMessage}`);
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
