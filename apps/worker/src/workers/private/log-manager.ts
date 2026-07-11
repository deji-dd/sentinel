import { Logger } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import {
  tornApi,
  getWorkerApiKey,
  PersonalLogs,
  LogSyncStates,
  type LogSyncStateDocument,
  type PersonalLogDocument,
  type TornSchema,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";

const WORKER_NAME = "log_manager";
const logger = new Logger(WORKER_NAME);

// Polling interval for new logs
const FORWARD_CADENCE_SEC = 60; // 60 seconds
// Polling interval for historical logs (slower to avoid rate limits)
const BACKWARD_CADENCE_SEC = 5; // 5 seconds

function getOrCreateSyncState(): LogSyncStateDocument {
  const stateId = "personal_log_sync_state_singleton";
  let state = LogSyncStates.findOne(stateId);

  if (!state) {
    const now = Math.floor(Date.now() / 1000);
    // Initialize cursors to now per user preference
    state = {
      id: stateId,
      latest_timestamp: now,
      earliest_timestamp: now,
      is_historical_sync_complete: false,
    };
    LogSyncStates.insertOne(state);
  }
  return state;
}

/**
 * Persists each individual API log and emits events
 */
function processFetchedLogs(
  batchResponse: TornSchema<"UserLogsResponse">,
  eventType: "NEW_PERSONAL_LOG" | "HISTORICAL_PERSONAL_LOG",
): number[] {
  if (!batchResponse.log || batchResponse.log.length === 0) {
    return [];
  }

  const timestamps: number[] = [];
  const newDocs: PersonalLogDocument[] = [];

  for (const log of batchResponse.log) {
    // Skip if we already have this log
    if (PersonalLogs.findOne(log.id)) continue;

    const doc: PersonalLogDocument = {
      ...log,
    };

    newDocs.push(doc);
    timestamps.push(log.timestamp);
    workerEvents.emit(eventType, log);
  }

  if (newDocs.length > 0) {
    PersonalLogs.insertMany(newDocs);
    logger.info(`Inserted ${newDocs.length} new logs.`);
  }

  return timestamps;
}

/**
 * Phase A: Forward Fill
 */
async function syncForwards(): Promise<void> {
  try {
    const state = getOrCreateSyncState();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { from: state.latest_timestamp, limit: 100 },
    });

    if (res.log && res.log.length > 0) {
      const timestamps = processFetchedLogs(res, "NEW_PERSONAL_LOG");
      if (timestamps.length > 0) {
        const newLatest = Math.max(...timestamps);
        if (newLatest > state.latest_timestamp) {
          state.latest_timestamp = newLatest;
          LogSyncStates.insertOne(state);
        }
      }
    }
  } catch (error) {
    logger.error("Error during forward sync:", error);
  }
}

/**
 * Phase B: Historical Backfill
 */
async function syncBackwards(): Promise<void> {
  try {
    const state = getOrCreateSyncState();
    if (state.is_historical_sync_complete) return; // Done

    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { to: state.earliest_timestamp, limit: 100 },
    });

    if (res.log && res.log.length > 0) {
      const timestamps = processFetchedLogs(res, "HISTORICAL_PERSONAL_LOG");
      if (timestamps.length > 0) {
        const newEarliest = Math.min(...timestamps);
        if (newEarliest < state.earliest_timestamp) {
          state.earliest_timestamp = newEarliest;
          LogSyncStates.insertOne(state);
        }
      }
    } else {
      // If Torn returns empty log array for a `to` query, we've hit the beginning
      state.is_historical_sync_complete = true;
      LogSyncStates.insertOne(state);
      logger.info("Historical sync complete!");
    }
  } catch (error) {
    logger.error("Error during backward sync:", error);
  }
}

export function startLogManager(): void {
  // We use two separate schedules for forward and backward syncing to manage
  // rate limits and interval speeds independently.

  startEventDrivenRunner({
    worker: `${WORKER_NAME}_forward`,
    handler: syncForwards,
    defaultCadenceSeconds: FORWARD_CADENCE_SEC,
  });

  startEventDrivenRunner({
    worker: `${WORKER_NAME}_backward`,
    handler: async () => {
      const state = LogSyncStates.findOne("personal_log_sync_state_singleton");
      if (state?.is_historical_sync_complete) return;
      await syncBackwards();
    },
    defaultCadenceSeconds: BACKWARD_CADENCE_SEC,
  });

  logger.info("Log Manager initialized");
}
