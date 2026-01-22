/**
 * Main worker orchestrator.
 * Manages multiple background job workers with cron scheduling.
 */

import { startSyncAbroadStocksWorker } from "./workers/sync-abroad-stocks.js";
import { startTravelTrackerWorker } from "./workers/track-travel.js";
import { startUserSyncWorker } from "./workers/sync-users.js";

function startAllWorkers(): void {
  console.log("🚀 Starting Sentinel workers...");

  try {
    // Start user sync worker (hourly)
    startUserSyncWorker();

    // Travel tracker worker with dynamic runtime (every 30s)
    startTravelTrackerWorker();

    // Abroad stocks sync worker (every 5 minutes)
    startSyncAbroadStocksWorker();

    console.log("✅ All workers started successfully");
  } catch (error) {
    console.error("❌ Failed to start workers:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n📛 Shutting down workers...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n📛 Terminating workers...");
  process.exit(0);
});

// Start workers
startAllWorkers();

// Keep process alive
console.log("✓ Workers running. Press Ctrl+C to exit.");
