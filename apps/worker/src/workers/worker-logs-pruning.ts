import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { logDuration } from "../lib/logger.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "worker_logs_pruning_worker";
const PRUNE_CADENCE_SECONDS = 86400; // Prune once daily
const RETENTION_DAYS = 30; // Keep 30 days of worker execution logs

/**
 * Prune old worker logs beyond retention window
 * Keeps 30 days of logs for debugging and performance analysis
 *
 * Growth estimate:
 * - ~15-20 workers running at varying cadences
 * - High-frequency workers (territory: 15-60s, war: 15s, battlestats: 60s, snapshots: 30s)
 * - Estimated 10,000-20,000 log entries per day
 * - 30 days = 300,000-600,000 rows max
 */
async function pruneWorkerLogs(): Promise<void> {
  const startTime = Date.now();
  const cutoffTime = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const db = getKysely();

  // Delete logs older than retention period
  const result = await db
    .deleteFrom(TABLE_NAMES.WORKER_LOGS)
    .where("created_at", "<", cutoffTime.toISOString())
    .executeTakeFirst();

  const deletedCount = Number(result.numDeletedRows) || 0;
  const duration = Date.now() - startTime;

  if (deletedCount > 0) {
    logDuration(
      WORKER_NAME,
      `Pruned ${deletedCount} worker logs older than ${RETENTION_DAYS} days`,
      duration,
    );
  } else {
    logDuration(WORKER_NAME, "No old worker logs to prune", duration);
  }
}

export function startWorkerLogsPruningWorker(): void {
  startDbScheduledRunner({
    worker: "worker_logs_pruning_worker",
    defaultCadenceSeconds: PRUNE_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: pruneWorkerLogs,
      });
    },
  });
}
