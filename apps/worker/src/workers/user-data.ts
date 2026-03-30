import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { logDuration, logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "user_data_worker";
const DB_WORKER_KEY = "user_data_worker";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function syncUserDataHandler(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
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
    const db = getKysely();
    await db
      .insertInto(TABLE_NAMES.USER_DATA)
      .values({
        player_id: profile.id,
        name: profile.name,
        is_donator: isDonator ? 1 : 0,
        profile_image: profile.image || null,
      })
      .onConflict((oc) =>
        oc.column("player_id").doUpdateSet({
          name: profile.name,
          is_donator: isDonator ? 1 : 0,
          profile_image: profile.image || null,
        }),
      )
      .execute();

    // Success - log completion
    const duration = Date.now() - startTime;
    logDuration(WORKER_NAME, `Sync completed`, duration);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(
      WORKER_NAME,
      `Profile sync failed: ${errorMessage} (${formatDuration(elapsed)})`,
    );
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
