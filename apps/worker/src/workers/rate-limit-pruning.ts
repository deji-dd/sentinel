import { executeSync } from "../lib/sync.js";
import { logError, logDuration } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const WORKER_NAME = "rate_limit_pruning_worker";
const PRUNE_CADENCE_SECONDS = 3600; // Prune every hour
const RETENTION_HOURS = 2; // Keep 2 hours of rate limit data (beyond the 60-second tracking window)

/**
 * Prune old rate limit requests that are no longer relevant
 * Keeps only the most recent 2 hours of data
 */
async function prunRateLimitRequests(): Promise<void> {
  const startTime = Date.now();

  try {
    const cutoffTime = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

    const { count, error } = await supabase
      .from(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER)
      .delete()
      .lt("timestamp", cutoffTime.toISOString());

    if (error) {
      throw error;
    }

    const elapsed = Date.now() - startTime;
    logDuration(
      WORKER_NAME,
      `Pruned ${count || 0} old rate limit entries`,
      elapsed,
    );
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Pruning failed: ${errorMessage}`);
    throw error;
  }
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
