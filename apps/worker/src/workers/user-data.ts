import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function syncUserDataHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();
  const startTime = Date.now();

  try {
    const profileResponse = await tornApi.get("/user/profile", { apiKey });
    const profile = profileResponse.profile;

    if (!profile?.id || !profile?.name) {
      throw new Error("Missing profile id or name in Torn response");
    }

    const isDonator =
      (profile.donator_status || "").toLowerCase() === "donator";

    // Personalized mode: upsert using player_id as primary key
    const { error } = await supabase.from(TABLE_NAMES.USER_DATA).upsert(
      {
        player_id: profile.id,
        name: profile.name,
        is_donator: isDonator,
        profile_image: profile.image || null,
      },
      { onConflict: "player_id" },
    );

    if (error) {
      throw error;
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error instanceof Object && "message" in error && "code" in error) {
      // PostgreSQL/Supabase error object
      logError(
        WORKER_NAME,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        `Profile sync failed: ${(error as any).message} (${formatDuration(elapsed)})`,
      );
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError(
        WORKER_NAME,
        `Profile sync failed: ${errorMessage} (${formatDuration(elapsed)})`,
      );
    }
    throw error; // Re-throw so executeSync knows this failed
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
        timeout: 10000,
        handler: syncUserDataHandler,
      });
    },
  });
}
