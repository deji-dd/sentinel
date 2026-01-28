import { startTravelDataWorker } from "./workers/travel-data.js";
import { startTravelStockCacheWorker } from "./workers/travel-stock-cache.js";
import { startTravelRecommendationsWorker } from "./workers/travel-recommendations.js";
import { startTravelAlerts } from "./workers/travel-alerts.js";
import { startUserDataWorker } from "./workers/user-data.js";
import { startUserBarsWorker } from "./workers/user-bars.js";
import { startUserCooldownsWorker } from "./workers/user-cooldowns.js";
import { startTornItemsWorker } from "./workers/torn-items.js";
import { logSection } from "./lib/logger.js";

function startAllWorkers(): void {
  logSection("🚀 Starting Sentinel workers");

  try {
    // Travel stock cache worker (every 5 minutes)
    startTravelStockCacheWorker();

    // Travel data worker (fixed 30s cadence)
    startTravelDataWorker();

    // Torn items worker (daily at ~03:00 UTC)
    startTornItemsWorker();

    // User data worker (every hour)
    startUserDataWorker();

    // User bars worker (every 30s)
    startUserBarsWorker();

    // User cooldowns worker (every 30s)
    startUserCooldownsWorker();

    // Travel recommendations worker (every 5 minutes)
    startTravelRecommendationsWorker();

    // Travel alerts worker (every 5 minutes)
    startTravelAlerts();

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
