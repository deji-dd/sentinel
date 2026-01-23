/**
 * Main worker orchestrator.
 * Manages multiple background job workers with DB-driven scheduling.
 */

import { startTravelDataWorker } from "./workers/travel-data.js";
import { startTravelStockCacheWorker } from "./workers/travel-stock-cache.js";
import { startMarketTrendsWorker } from "./workers/market-trends.js";
import { startUserDataWorker } from "./workers/user-data.js";

function startAllWorkers(): void {
  console.log("🚀 Starting Sentinel workers...");

  try {
    // Travel data worker (dynamic timing, default 30s) - updates sentinel_travel_data
    startTravelDataWorker();

    // Travel stock cache worker (every 5 minutes) - updates sentinel_travel_stock_cache
    startTravelStockCacheWorker();

    // Market trends worker (every 5 minutes) - updates sentinel_market_trends
    startMarketTrendsWorker();

    // User data worker (every hour) - updates sentinel_user_data
    startUserDataWorker();

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
