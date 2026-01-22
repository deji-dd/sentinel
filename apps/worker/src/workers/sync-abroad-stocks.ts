import cron from "node-cron";
import { executeSync } from "../lib/sync.js";
import { syncAbroadStocks } from "../tasks/syncAbroadStocks.js";

const WORKER_NAME = "sync-abroad-stocks";
const CRON_SCHEDULE = "*/5 * * * *"; // every 5 minutes

/**
 * Initialize the abroad stocks sync worker with cron scheduling.
 * Fetches foreign stock data from YATA API every 5 minutes.
 */
export function startSyncAbroadStocksWorker(): void {
  console.log("Starting abroad stocks sync worker...");

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000, // 30 second timeout
        handler: syncAbroadStocks,
      });
    } catch (error) {
      console.error(`[${WORKER_NAME}] Cron tick failed:`, error);
      // Continue on error, cron will retry in 5 minutes
    }
  });

  console.log(`Abroad stocks sync scheduled: ${CRON_SCHEDULE}`);

  // Run immediately on startup
  console.log("Running initial sync...");
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncAbroadStocks,
  }).catch((error) => {
    console.error(`[${WORKER_NAME}] Initial sync failed:`, error);
  });

  return task as any;
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startSyncAbroadStocksWorker();

  // Keep process alive
  console.log("Worker running. Press Ctrl+C to exit.");
}
