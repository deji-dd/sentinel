import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { syncAbroadStocks } from "../tasks/syncAbroadStocks.js";
import { log, logError } from "../lib/logger.js";

const WORKER_NAME = "sync-abroad-stocks";
const CRON_SCHEDULE = "*/5 * * * *"; // every 5 minutes

/**
 * Initialize the abroad stocks sync worker with cron scheduling.
 * Fetches foreign stock data from YATA API every 5 minutes.
 */
export function startSyncAbroadStocksWorker(): void {
  log(WORKER_NAME, "Starting worker...");

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000, // 30 second timeout
        handler: syncAbroadStocks,
      });
    } catch (error) {
      logError(WORKER_NAME, `Cron tick failed: ${error}`);
      // Continue on error, cron will retry in 5 minutes
    }
  });

  log(WORKER_NAME, `Scheduled: ${CRON_SCHEDULE}`);

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncAbroadStocks,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });

  return task as any;
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startSyncAbroadStocksWorker();

  // Keep process alive
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
