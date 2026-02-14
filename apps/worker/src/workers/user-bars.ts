import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey, upsertUserBars, type UserBarsData } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_bars_worker";
const DB_WORKER_KEY = "user_bars_worker";

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

async function syncUserBarsHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  const updates: UserBarsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

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
    // If max = 150: 5 energy per 10 minutes = 120 seconds per point
    // If max = 100: 5 energy per 15 minutes = 180 seconds per point
    const energySecondsPerPoint = energyMaximum === 150 ? 120 : 180;

    // Calculate nerve regen rate: 1 nerve per 5 minutes = 300 seconds per point
    const nerveSecondsPerPoint = 300;

    // Time to full from 0 (in seconds)
    const energyFlatTimeToFull = energyMaximum * energySecondsPerPoint;
    const nerveFlatTimeToFull = nerveMaximum * nerveSecondsPerPoint;

    // Time to full from current value (in seconds)
    const energyTimeToFull =
      (energyMaximum - energyCurrent) * energySecondsPerPoint;
    const nerveTimeToFull =
      (nerveMaximum - nerveCurrent) * nerveSecondsPerPoint;

    updates.push({
      user_id: PERSONAL_USER_ID,
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
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    errors.push({ userId: PERSONAL_USER_ID, error: errorMessage });
    logError(WORKER_NAME, `${PERSONAL_USER_ID}: ${errorMessage}`);
  }

  if (updates.length > 0) {
    await upsertUserBars(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `Bars sync failed: ${errors[0]?.error}`);
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
