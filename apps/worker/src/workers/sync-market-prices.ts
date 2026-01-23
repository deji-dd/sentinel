import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { syncMarketPrices } from "../tasks/syncMarketPrices.js";
import { log, logError } from "../lib/logger.js";

const WORKER_NAME = "sync-market-prices";
const CRON_SCHEDULE = "*/5 * * * *"; // every 5 minutes

/**
 * Initialize the market prices sync worker with cron scheduling.
 * Fetches cheapest listing prices from Torn market every 5 minutes.
 */
export function startSyncMarketPricesWorker(): void {
  log(WORKER_NAME, "Starting worker...");

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await executeSync({
        name: WORKER_NAME,
        timeout: 120000, // 120 second timeout (items loop + delays)
        handler: syncMarketPrices,
      });
    } catch (error) {
      logError(WORKER_NAME, `Cron tick failed: ${error}`);
      // Continue on error, cron will retry in 5 minutes
    }
  });

  log(WORKER_NAME, `Scheduled: ${CRON_SCHEDULE}`);

  // Run immediately on startup
  log(WORKER_NAME, "Running initial sync...");
  executeSync({
    name: WORKER_NAME,
    timeout: 120000,
    handler: syncMarketPrices,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });

  return task as any;
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startSyncMarketPricesWorker();

  // Keep process alive
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
