import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey, upsertUserCooldowns, type UserCooldownsData } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "user_cooldowns_worker";
const DB_WORKER_KEY = "user_cooldowns_worker";

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

async function syncUserCooldownsHandler(): Promise<void> {
  const apiKey = getPersonalApiKey();

  const updates: UserCooldownsData[] = [];
  const errors: Array<{ userId: string; error: string }> = [];

  try {
    const cooldownsResponse = await tornApi.get("/user/cooldowns", {
      apiKey,
    });
    const cooldowns = cooldownsResponse.cooldowns;

    if (!cooldowns) {
      throw new Error("Missing cooldowns in Torn response");
    }

    updates.push({
      user_id: PERSONAL_USER_ID,
      drug: cooldowns.drug || 0,
      medical: cooldowns.medical || 0,
      booster: cooldowns.booster || 0,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    errors.push({ userId: PERSONAL_USER_ID, error: errorMessage });
    logError(WORKER_NAME, `${PERSONAL_USER_ID}: ${errorMessage}`);
  }

  if (updates.length > 0) {
    await upsertUserCooldowns(updates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `Cooldowns sync failed: ${errors[0]?.error}`);
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
