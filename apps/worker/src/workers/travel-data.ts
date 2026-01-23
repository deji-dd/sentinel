import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertTravelData,
  type TravelData,
} from "../lib/supabase.js";
import { fetchTornUserBasic, fetchTornUserTravel } from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { dateToIsoOrNull, epochSecondsToDate } from "../lib/time.js";

const WORKER_NAME = "travel-data-worker";

/**
 * Travel data worker - syncs travel status and capacity from Torn API.
 * Updates sentinel_travel_data table with dynamic timing based on travel status.
 *
 * Logic:
 * - Fetches travel status and capacity for all users
 * - Updates travel destination, method, times, capacity
 * - Dynamic timing: polls more frequently when users are traveling
 */
async function syncTravelDataHandler(): Promise<void> {
  const users = await getAllUsers();
  log(WORKER_NAME, `Syncing travel data for ${users.length} users`);

  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users to sync");
    return;
  }

  const travelUpdates: Array<
    TravelData & { capacity?: number; capacity_manually_set?: boolean }
  > = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);

      // Fetch travel status and basic profile (for capacity)
      const [travelResponse, basicResponse] = await Promise.all([
        fetchTornUserTravel(apiKey),
        fetchTornUserBasic(apiKey),
      ]);

      const travel = travelResponse.travel;
      const apiCapacity = basicResponse.profile?.capacity ?? 0;

      const departedAt = epochSecondsToDate(travel?.departed_at ?? null);
      const arrivalAt = epochSecondsToDate(travel?.arrival_at ?? null);
      const timeLeft = travel?.time_left ?? 0;

      const update: TravelData & { capacity_manually_set?: boolean } = {
        user_id: user.user_id,
        travel_destination: travel?.destination ?? null,
        travel_method: travel?.method ?? null,
        travel_departed_at: dateToIsoOrNull(departedAt),
        travel_arrival_at: dateToIsoOrNull(arrivalAt),
        travel_time_left: timeLeft ?? null,
        capacity: apiCapacity,
      };

      travelUpdates.push(update);

      log(
        WORKER_NAME,
        `User ${user.player_id}: ${travel?.destination ?? "not traveling"}, api_capacity=${apiCapacity}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `Failed for user ${user.user_id}: ${errorMessage}`);
    }
  }

  if (travelUpdates.length > 0) {
    await upsertTravelData(travelUpdates);
    logSuccess(WORKER_NAME, `Updated ${travelUpdates.length} travel records`);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} users failed to sync`);
  }
}

/**
 * Start travel data worker with DB-driven scheduling.
 * Default cadence is 30s (configured in DB).
 */
export function startTravelDataWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: "travel_data_worker",
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncTravelDataHandler,
      });
    },
  });

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncTravelDataHandler,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTravelDataWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
