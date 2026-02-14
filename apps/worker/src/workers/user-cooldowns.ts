import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_cooldowns_worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

async function syncUserCooldownsHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  try {
    const cooldownsResponse = await tornApi.get("/user/cooldowns", {
      apiKey,
    });
    const cooldowns = cooldownsResponse.cooldowns;

    if (!cooldowns) {
      throw new Error("Missing cooldowns in Torn response");
    }

    // Personalized mode: single-row upsert (id = 1)
    const { error } = await supabase
      .from(TABLE_NAMES.USER_COOLDOWNS)
      .upsert(
        {
          id: 1,
          drug: cooldowns.drug || 0,
          medical: cooldowns.medical || 0,
          booster: cooldowns.booster || 0,
        },
        { onConflict: "id" },
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Cooldowns sync failed: ${errorMessage}`);
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
        timeout: 30000,
        handler: syncUserCooldownsHandler,
      });
    },
  });
}
