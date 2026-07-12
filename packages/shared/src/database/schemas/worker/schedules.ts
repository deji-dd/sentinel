import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type WorkerScheduleDocument = BaseDocument & {
  enabled: boolean;
  cadence_seconds: number;
  next_run_at: number; // Stored as Unix epoch milliseconds
  last_run_at: number | null;
  force_run: boolean;
};

export const WorkerSchedules = new Collection<WorkerScheduleDocument>(
  sentinelDbEngine,
  "worker_schedules",
);
