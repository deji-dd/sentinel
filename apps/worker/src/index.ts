import { startTravelDataWorker } from "./workers/travel-data.js";
import { startTravelStockCacheWorker } from "./workers/travel-stock-cache.js";
import { startUserDataWorker } from "./workers/user-data.js";
import { startUserBarsWorker } from "./workers/user-bars.js";
import { startUserCooldownsWorker } from "./workers/user-cooldowns.js";
import { startTornItemsWorker } from "./workers/torn-items.js";
import { logSection } from "./lib/logger.js";

function startAllWorkers(): void {
  logSection("🚀 Starting Sentinel workers");

  try {
    // Travel data worker (fixed 30s cadence)
    startTravelDataWorker();

    // Travel stock cache worker (every 5 minutes)
    startTravelStockCacheWorker();

    // Torn items worker (daily at ~03:00 UTC)
    startTornItemsWorker();

    // User data worker (every hour)
    startUserDataWorker();

    // User bars worker (every 30s)
    startUserBarsWorker();

    // User cooldowns worker (every 30s)
    startUserCooldownsWorker();

    logSection("✅ All workers started");
  } catch (error) {
    console.error("❌ Failed to start workers:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  logSection("📛 Shutting down workers");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logSection("📛 Terminating workers");
  process.exit(0);
});

// Start workers
startAllWorkers();
