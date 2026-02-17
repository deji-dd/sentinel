// import { startTravelDataWorker } from "./workers/travel-data.js";
// import { startTravelStockCacheWorker } from "./workers/travel-stock-cache.js";
// import { startTravelRecommendationsWorker } from "./workers/travel-recommendations.js";
// import { startTravelAlerts } from "./workers/travel-alerts.js";
import { startUserDataWorker } from "./workers/user-data.js";
import { startTornItemsWorker } from "./workers/torn-items.js";
import { startTornGymsWorker } from "./workers/torn-gyms.js";
import {
  startUserSnapshotWorker,
  startUserSnapshotPruningWorker,
} from "./workers/user-snapshot.js";
import { startTrainingRecommendationsWorker } from "./workers/training-recommendations.js";
import { logSection } from "./lib/logger.js";

function startAllWorkers(): void {
  logSection("🚀 Starting Sentinel workers");

  try {
    // Torn items worker (daily at ~03:00 UTC)
    startTornItemsWorker();

    // Torn gyms worker (daily at ~03:00 UTC)
    startTornGymsWorker();

    // User data worker (every hour)
    startUserDataWorker();

    // User snapshot worker (every 30s - includes bars and cooldowns)
    startUserSnapshotWorker();

    // User snapshot pruning worker (every hour)
    startUserSnapshotPruningWorker();

    // Training recommendations worker (every 10 minutes)
    startTrainingRecommendationsWorker();

    // ⚠️  DISABLED: Travel module workers (on backburner)
    // - startTravelStockCacheWorker(); // every 5 minutes
    // - startTravelDataWorker(); // fixed 30s cadence
    // - startTravelRecommendationsWorker(); // every 5 minutes
    // - startTravelAlerts(); // every 5 minutes

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
