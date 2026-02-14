import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  getPersonalApiKey,
  upsertUserBars,
  type UserBarsData,
} from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_bars_worker";
const DB_WORKER_KEY = "user_bars_worker";

// Get the single personalized user ID from environment or use a default UUID
const PERSONAL_USER_ID = process.env.SENTINEL_USER_ID || "f47ac10b-58cc-4372-a567-0e02b2c3d479";

async function syncUserBarsHandler(): Promise<void> {
  // Personalized bot mode: use single API key from environment
  let users: Array<{ user_id: string; api_key: string }>;
  
  try {
    const apiKey = getPersonalApiKey();
    users = [{ user_id: PERSONAL_USER_ID, api_key: apiKey }];
  } catch (error) {
    // Fall back to multi-user mode if TORN_API_KEY not set
    users = await getAllUsers();
    if (users.length === 0) {
      return;
    }
  }

  const updates: UserBarsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      // In personalized mode, API key is not encrypted; in multi-user mode, it is
      const apiKey = user.api_key.length === 16 
        ? user.api_key 
        : decrypt(user.api_key);
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
        user_id: user.user_id,
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
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `${user.user_id}: ${errorMessage}`);
    }
  }

  if (updates.length > 0) {
    await upsertUserBars(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length}/${users.length} users failed`);
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
