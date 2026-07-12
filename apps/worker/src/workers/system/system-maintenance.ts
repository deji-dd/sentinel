import { executeSync } from "../../lib/sync.js";
import { Logger } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

// Import the collections that need pruning
import { RateLimits } from "@sentinel/shared";

const WORKER_NAME = "system_maintenance";
const logger = new Logger(WORKER_NAME);

/**
 * Executes daily system cleanup and data retention tasks.
 * Prevents SQLite from bloating with historical job logs and expired rate limits.
 */
async function runPruningJobs(): Promise<void> {
  const finishSync = logger.time();

  // 2. Prune Rate Limit cache older than 1 day
  // Since WINDOW_MS is only 60 seconds, anything older than 24h is definitely dead weight
  const rateLimitsDeleted = RateLimits.deleteOlderThan(1, "$.requested_at");
  logger.info(`Pruned ${rateLimitsDeleted} expired rate limit entries.`);

  finishSync();
}

export async function executeMaintenance(): Promise<void> {
  await runPruningJobs();
}

/**
 * Initializes the automated daily data retention manager.
 */
export function startSystemMaintenance(): void {
  const ONE_DAY_SECONDS = 86400;

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: ONE_DAY_SECONDS,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 300000,
        handler: executeMaintenance,
      });
    },
  });
}
