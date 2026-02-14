import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "user_bars_worker";
const DB_WORKER_KEY = "user_bars_worker";

async function syncUserBarsHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  try {
    const barsResponse = await tornApi.get("/user/bars", { apiKey });
    const bars = barsResponse.bars;

    if (!bars) {
      throw new Error("Missing bars in Torn response");
    }

    const energyCurrent = bars.energy?.current || 0;
    const energyMaximum = bars.energy?.maximum || 0;
    const nerveCurrent = bars.nerve?.current || 0;
    const nerveMaximum = bars.nerve?.maximum || 0;

    // Calculate energy regen rate (seconds per point)
    const energySecondsPerPoint = energyMaximum === 150 ? 120 : 180;
    const nerveSecondsPerPoint = 300;

    // Time to full from 0 (in seconds)
    const energyFlatTimeToFull = energyMaximum * energySecondsPerPoint;
    const nerveFlatTimeToFull = nerveMaximum * nerveSecondsPerPoint;
    const energyTimeToFull =
      (energyMaximum - energyCurrent) * energySecondsPerPoint;
    const nerveTimeToFull =
      (nerveMaximum - nerveCurrent) * nerveSecondsPerPoint;

    // Personalized mode: single-row upsert (id = 1)
    const { error } = await supabase
      .from(TABLE_NAMES.USER_BARS)
      .upsert(
        {
          id: 1,
          energy_current: energyCurrent,
          energy_maximum: energyMaximum,
          nerve_current: nerveCurrent,
          nerve_maximum: nerveMaximum,
          happy_current: bars.happy?.current || 0,
          happy_maximum: bars.happy?.maximum || 0,
          life_current: bars.life?.current || 0,
          life_maximum: bars.life?.maximum || 0,
          energy_flat_time_to_full: energyFlatTimeToFull,
          energy_time_to_full: energyTimeToFull,
          nerve_flat_time_to_full: nerveFlatTimeToFull,
          nerve_time_to_full: nerveTimeToFull,
        },
        { onConflict: "id" },
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Bars sync failed: ${errorMessage}`);
  }
}

export function startUserBarsWorker(): void {
  startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    defaultCadenceSeconds: 30,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncUserBarsHandler,
      });
    },
  });
}
