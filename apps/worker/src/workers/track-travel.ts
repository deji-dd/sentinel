import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  getWorkerSchedules,
  upsertTravelData,
  upsertWorkerSchedules,
  type TravelData,
  type WorkerSchedule,
} from "../lib/supabase.js";
import { fetchTornUserTravel } from "../services/torn.js";
import { log, logError, logWarn } from "../lib/logger.js";
import {
  dateToIsoOrNull,
  epochSecondsToDate,
  secondsFromNow,
} from "../lib/time.js";

const WORKER_NAME = "travel-tracker";
const CRON_SCHEDULE = "*/30 * * * * *"; // every 30 seconds
const ARRIVAL_BUFFER_SECONDS = 5 * 60;
const MIN_IDLE_SECONDS = 15;
const MAX_IDLE_SECONDS = 30;
const ERROR_BACKOFF_SECONDS = 5 * 60;

function computeNextRun(timeLeftSeconds: number | null | undefined): Date {
  if (timeLeftSeconds && timeLeftSeconds > 0) {
    const secondsUntil = Math.max(
      timeLeftSeconds - ARRIVAL_BUFFER_SECONDS,
      MIN_IDLE_SECONDS,
    );
    return secondsFromNow(secondsUntil);
  }

  const jitterSeconds =
    MIN_IDLE_SECONDS +
    Math.floor(Math.random() * (MAX_IDLE_SECONDS - MIN_IDLE_SECONDS + 1));
  return secondsFromNow(jitterSeconds);
}

async function trackTravelHandler(): Promise<void> {
  const users = await getAllUsers();
  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users found.");
    return;
  }

  const schedules = await getWorkerSchedules(WORKER_NAME);
  const now = new Date();

  const dueUsers = users.filter((user) => {
    const schedule = schedules.get(user.user_id) as WorkerSchedule | undefined;
    if (!schedule) return true;
    return new Date(schedule.next_run_at) <= now;
  });

  if (dueUsers.length === 0) {
    logWarn(WORKER_NAME, "No users due this tick.");
    return;
  }

  const travelUpdates: TravelData[] = [];
  const scheduleUpdates: WorkerSchedule[] = [];

  for (const user of dueUsers) {
    try {
      const apiKey = decrypt(user.api_key);
      const travelResponse = await fetchTornUserTravel(apiKey);
      const travel = travelResponse.travel;

      const departedAt = epochSecondsToDate(travel?.departed_at ?? null);
      const arrivalAt = epochSecondsToDate(travel?.arrival_at ?? null);
      const timeLeft = travel?.time_left ?? 0;

      travelUpdates.push({
        user_id: user.user_id,
        travel_destination: travel?.destination ?? null,
        travel_method: travel?.method ?? null,
        travel_departed_at: dateToIsoOrNull(departedAt),
        travel_arrival_at: dateToIsoOrNull(arrivalAt),
        travel_time_left: timeLeft ?? null,
      });

      const nextRunAt = computeNextRun(timeLeft);
      scheduleUpdates.push({
        user_id: user.user_id,
        worker: WORKER_NAME,
        next_run_at: nextRunAt.toISOString(),
      });

      log(WORKER_NAME, `Updated travel for user ${user.user_id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(WORKER_NAME, `Failed for user ${user.user_id}: ${message}`);

      const backoff = secondsFromNow(ERROR_BACKOFF_SECONDS);
      scheduleUpdates.push({
        user_id: user.user_id,
        worker: WORKER_NAME,
        next_run_at: backoff.toISOString(),
      });
    }
  }

  if (travelUpdates.length > 0) {
    await upsertTravelData(travelUpdates);
  }

  if (scheduleUpdates.length > 0) {
    await upsertWorkerSchedules(scheduleUpdates);
  }
}

export function startTravelTrackerWorker(): void {
  log(WORKER_NAME, "Starting worker...");

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: trackTravelHandler,
      });
    } catch (error) {
      logError(WORKER_NAME, `Cron tick failed: ${error}`);
    }
  });

  log(WORKER_NAME, `Scheduled: ${CRON_SCHEDULE}`);

  // Run once on startup
  trackTravelHandler().catch((error) => {
    logError(WORKER_NAME, `Initial run failed: ${error}`);
  });

  return task as any;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTravelTrackerWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
