/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_cooldowns_worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function syncUserCooldownsHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();
  const startTime = Date.now();

  try {
    const cooldownsResponse = await tornApi.get("/user/cooldowns", {
      apiKey,
    });
    const cooldowns = cooldownsResponse.cooldowns;

    if (!cooldowns) {
      throw new Error("Missing cooldowns in Torn response");
    }

    // Fetch player_id from user_data (set by profile sync worker)
    const { data: userData, error: fetchError } = await supabase
      .from(TABLE_NAMES.USER_DATA)
      .select("player_id")
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!userData?.player_id) {
      throw new Error(
        "Profile not synced yet - cooldowns cannot be stored without player_id",
      );
    }

    // Personalized mode: upsert using player_id as primary key
    const { error } = await supabase.from(TABLE_NAMES.USER_COOLDOWNS).upsert(
      {
        player_id: userData.player_id,
        drug: cooldowns.drug || 0,
        medical: cooldowns.medical || 0,
        booster: cooldowns.booster || 0,
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
        `Cooldowns sync failed: ${(error as any).message} (${formatDuration(elapsed)})`,
      );
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError(
        WORKER_NAME,
        `Cooldowns sync failed: ${errorMessage} (${formatDuration(elapsed)})`,
      );
    }
    throw error; // Re-throw so executeSync knows this failed
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
        timeout: 10000,
        handler: syncUserCooldownsHandler,
      });
    },
  });
}
