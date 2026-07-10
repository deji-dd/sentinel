import { executeSync } from "../../lib/sync.js";
import { Logger } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { tornApi, getSystemKeyPool } from "@sentinel/shared";
import { TerritoryBlueprints, WorkerSchedules } from "@sentinel/shared";
import type { TornSchema } from "@sentinel/shared";

const WORKER_NAME = "territory_blueprints";
const logger = new Logger(WORKER_NAME);

/**
 * Represents a strictly typed, single territory blueprint object extracted
 * natively from the Torn OpenAPI schema response.
 */
type SingleTerritory = NonNullable<
  TornSchema<"TornTerritoriesResponse">["territory"]
>[number];

/**
 * Calculates the epoch timestamp for the next execution target.
 * Enforces a strict daily cadence by targeting the next upcoming 03:00 UTC.
 * If the worker has missed a 24-hour window, it returns the current timestamp
 * to trigger an immediate catch-up sync.
 * * @param {number | null} lastRunAt - The epoch ms of the last successful execution, or null if never run.
 * @returns {number} The target epoch timestamp in milliseconds for the next execution.
 */
function getNext0300UtcTimestamp(lastRunAt: number | null): number {
  const now = Date.now();
  if (!lastRunAt || now - lastRunAt > 86400000) return now;
  const target = new Date(now);
  target.setUTCHours(3, 0, 0, 0);
  if (now >= target.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime();
}

/**
 * Core extraction and transformation engine for territory blueprints.
 * Rapidly paginates through the Torn API using a rotating system key pool,
 * fetching the static geographic and structural data (sizes, coordinates, neighbors)
 * for all ~4,108 territories simultaneously.
 * * Executes a bulk NoSQL upsert to mirror the state locally and automatically
 * recalculates its own schedule to align with the next 03:00 UTC.
 * * @throws {Error} Rethrows network or API errors to the parent scheduler to initiate a safe sleep cycle.
 * @returns {Promise<void>} Resolves when the transaction is successfully committed to the database.
 */
async function fetchAndDumpBlueprints(): Promise<void> {
  const finishLog = logger.time("Syncing territory blueprints.");

  try {
    // 1. Initialize API key rotator for parallel execution
    const keys = getSystemKeyPool();
    let keyIndex = 0;
    const getKey = () => keys[keyIndex++ % keys.length];

    const limit = 250;
    const estimatedTotal = 4500; // ~4,108 territories exist, padding to 4,500 guarantees coverage
    const pageCount = Math.ceil(estimatedTotal / limit);
    const offsets = Array.from({ length: pageCount }, (_, i) => i * limit);

    // 2. Execute massive parallel fetch
    const responses = await Promise.all(
      offsets.map(
        (offset) =>
          tornApi.get("/torn/territory", {
            apiKey: getKey(),
            queryParams: { offset, limit },
          }) as Promise<TornSchema<"TornTerritoriesResponse">>,
      ),
    );

    // 3. Flatten the array of responses into a single array of territories
    const territories: SingleTerritory[] = responses.flatMap(
      (res) => res.territory || [],
    );

    if (territories.length === 0) {
      logger.warn("Received empty territories response from Torn API.");
      return;
    }

    // 4. Map to NoSQL where ID = Territory Name (e.g., 'JCA')
    const docsToUpsert = territories.map((tt) => ({
      id: tt.id,
      data: tt,
    }));

    if (docsToUpsert.length > 0) {
      TerritoryBlueprints.insertMany(docsToUpsert);
    }

    // 5. Self-Heal Schedule
    const schedule = WorkerSchedules.findOne(WORKER_NAME);
    if (schedule) {
      const next3AM = getNext0300UtcTimestamp(Date.now());
      schedule.cadence_seconds = Math.max(
        60,
        Math.floor((next3AM - Date.now()) / 1000),
      );
      WorkerSchedules.insertOne(schedule);
    }

    finishLog(`Stored ${docsToUpsert.length} territories.`);
  } catch (error) {
    logger.error("Failed to sync territory blueprints", error);
    throw error;
  }
}

/**
 * Initializes and boots the territory blueprint background worker.
 * Employs self-healing schedule logic on startup: if no schedule exists or if
 * the server was offline and missed a daily sync, it forces an immediate run.
 * Otherwise, it seamlessly attaches to the event-driven loop and sleeps until 03:00 UTC.
 */
export function startTerritoryBlueprintSync(): void {
  // Pre-initialize the schedule if it doesn't exist to force the 03:00 UTC alignment
  let schedule = WorkerSchedules.findOne(WORKER_NAME);

  if (!schedule) {
    const nextRunMs = getNext0300UtcTimestamp(null);

    WorkerSchedules.insertOne({
      id: WORKER_NAME,
      enabled: true,
      cadence_seconds: 86400,
      next_run_at: nextRunMs,
      last_run_at: null,
      force_run: false,
    });
  } else {
    // Check if the server was offline and we missed a day
    const targetRun = getNext0300UtcTimestamp(schedule.last_run_at);
    if (targetRun <= Date.now()) {
      schedule.next_run_at = Date.now();
      WorkerSchedules.insertOne(schedule);
    }
  }

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400,
    handler: async () =>
      await executeSync({
        name: WORKER_NAME,
        timeout: 300000,
        handler: fetchAndDumpBlueprints,
      }),
  });
}
