import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

/**
 * Represents a single log entry fetched from the Torn API.
 */
export type PersonalLogDocument = BaseDocument & TornSchema<"UserLog"> & {};

/**
 * Tracks the synchronization state of the personal log manager.
 * Since we have two phases (forward real-time and backward historical),
 * we track two cursors.
 */
export type LogSyncStateDocument = BaseDocument & {
  latest_timestamp: number; // For phase A: fetching new logs forwards
  earliest_timestamp: number; // For phase B: fetching historical logs backwards
  is_historical_sync_complete: boolean; // Flips to true when we hit the very beginning of the account
};

export const PersonalLogs = new Collection<PersonalLogDocument>(
  sentinelDbEngine,
  "personal_logs",
  [
    { key: "category", type: "TEXT" },
    { key: "timestamp", type: "INTEGER" },
  ],
);

export const LogSyncStates = new Collection<LogSyncStateDocument>(
  sentinelDbEngine,
  "personal_log_sync_state",
);
