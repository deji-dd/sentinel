import { executeSync } from "../../lib/sync.js";
import { Logger } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { tornApi, getWorkerApiKey } from "@sentinel/shared";
import { TornItems, TornSchema, WorkerSchedules } from "@sentinel/shared";

const WORKER_NAME = "items_sync";
const logger = new Logger(WORKER_NAME);
const ONE_DAY_SECONDS = 86400;

/**
 * Calculates the target timestamp for the next execution.
 * If more than 24 hours have passed since the last run, triggers immediately.
 * Otherwise, targets the next upcoming 03:00 UTC.
 * @param lastRunAt - The epoch timestamp of the last successful run (or null if never).
 */
function getNext0300UtcTimestamp(lastRunAt: number | null): number {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // 1. Force immediate run if never run or if it missed a full 24h window
  if (!lastRunAt || now - lastRunAt > ONE_DAY_MS) {
    return now;
  }

  // 2. Otherwise, find the next 03:00 UTC
  const target = new Date(now);
  target.setUTCHours(3, 0, 0, 0);

  if (now >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime();
}
/**
 * Core extraction logic. Fetches the raw Torn items list and performs a
 * fast NoSQL upsert to mirror the state in the local database.
 */
async function fetchAndDumpItems(): Promise<void> {
  const finishSync = logger.time("Starting items sync.");

  try {
    // 1. Fetch raw data from the API
    const apiKey = getWorkerApiKey("personal");
    const response = (await tornApi.get("/torn/items", {
      apiKey,
    })) as TornSchema<"TornItemsResponse">;

    const items = response.items;

    if (!items || items.length === 0) {
      logger.warn("Received empty items array from Torn API.");
      return;
    }

    // 1. Pull the entire existing database state into a high-speed RAM Map
    // Key: Torn Numeric ID (as string), Value: Full NoSQL Document
    const existingDocs = TornItems.findAll();
    const existingMap = new Map(
      existingDocs.map((doc) => [String(doc.data.id), doc]),
    );

    const docsToUpsert = [];
    let newCount = 0;
    let updateCount = 0;

    // 2. Iterate the API response and prepare the payload purely in memory
    for (const itemData of items) {
      const tornId = String(itemData.id);
      const existing = existingMap.get(tornId);

      if (existing) {
        existing.data = { ...itemData, item_id: itemData.id };
        docsToUpsert.push(existing);
        updateCount++;
      } else {
        docsToUpsert.push({
          id: crypto.randomUUID(),
          data: { ...itemData, item_id: itemData.id },
        });
        newCount++;
      }
    }

    // 3. Execute a single, highly-optimized SQLite transaction
    if (docsToUpsert.length > 0) {
      TornItems.insertMany(docsToUpsert);
    }

    finishSync(
      `Item sync complete. Added: ${newCount}, Updated: ${updateCount}`,
    );

    // --- NEW REALIGNMENT LOGIC ---
    // Dynamically adjust the cadence so the scheduler's next jump lands exactly on 03:00 UTC
    const schedule = WorkerSchedules.findOne(WORKER_NAME);
    if (schedule) {
      // Pass Date.now() so it calculates the next 3 AM, not an immediate trigger
      const next3AM = getNext0300UtcTimestamp(Date.now());
      const secondsUntil3AM = Math.floor((next3AM - Date.now()) / 1000);

      // Enforce a minimum 60s jump in case it finishes at exactly 03:00:00 to prevent loops
      schedule.cadence_seconds = Math.max(60, secondsUntil3AM);
      WorkerSchedules.insertOne(schedule);
    }
  } catch (error) {
    logger.error("Failed to sync Torn items", error);
    throw error; // Re-throw to ensure the scheduler's finally block handles the failure
  }
}

/**
 * Wraps the execution logic in the lock manager to prevent overlap.
 */
export async function executeItemSync(): Promise<void> {
  await fetchAndDumpItems();
}

/**
 * Initializes the background runner.
 * Injects a dynamic `next_run_at` on the first boot to align the cadence to 03:00 UTC.
 */
export function startItemSyncWorker(): void {
  let schedule = WorkerSchedules.findOne(WORKER_NAME);

  if (!schedule) {
    // Brand new schedule
    const nextRunMs = getNext0300UtcTimestamp(null);

    WorkerSchedules.insertOne({
      id: WORKER_NAME,
      enabled: true,
      cadence_seconds: ONE_DAY_SECONDS,
      next_run_at: nextRunMs,
      last_run_at: null,
      force_run: false,
    });
  } else {
    // Existing schedule: Check if the server was offline and we missed a day
    const targetRun = getNext0300UtcTimestamp(schedule.last_run_at);
    if (targetRun <= Date.now()) {
      schedule.next_run_at = Date.now();
      WorkerSchedules.insertOne(schedule);
    }
  }

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: ONE_DAY_SECONDS,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 600000,
        handler: executeItemSync,
      });
    },
  });
}
