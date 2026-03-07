import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { logDuration } from "../lib/logger.js";
import { getDB } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "rate_limit_pruning_worker";
const PRUNE_CADENCE_SECONDS = 3600; // Prune every hour
const RETENTION_HOURS = 2; // Keep 2 hours of rate limit data (beyond the 60-second tracking window)

/**
 * Prune old rate limit requests that are no longer relevant
 * Keeps only the most recent 2 hours of data
 */
async function prunRateLimitRequests(): Promise<void> {
  const startTime = Date.now();
  const cutoffTime = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  const db = getDB();
  db.prepare(
    `DELETE FROM "${TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER}" WHERE requested_at < ?`,
  ).run(cutoffTime.toISOString());

  const duration = Date.now() - startTime;
  logDuration(WORKER_NAME, "Sync completed", duration);
}

export function startRateLimitPruningWorker(): void {
  startDbScheduledRunner({
    worker: "rate_limit_pruning_worker",
    defaultCadenceSeconds: PRUNE_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: prunRateLimitRequests,
      });
    },
  });
}
