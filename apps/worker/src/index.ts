// import { startTravelDataWorker } from "./workers/travel-data.js";
// import { startTravelStockCacheWorker } from "./workers/travel-stock-cache.js";
// import { startTravelRecommendationsWorker } from "./workers/travel-recommendations.js";
// import { startTravelAlerts } from "./workers/travel-alerts.js";
import {
  startUserDataWorker,
  startTornGymsWorker,
  startUserSnapshotWorker,
  startUserSnapshotPruningWorker,
  startTrainingRecommendationsWorker,
  startBattlestatsSyncWorker,
  startBattlestatsPruningWorker,
} from "./workers/private/index.js";
import {
  startTornItemsWorker,
  startFactionSyncWorker,
  startTerritoryBlueprintSyncWorker,
  startWarLedgerSyncWorker,
  startTerritoryStateSyncWorker,
  startRateLimitPruningWorker,
  startWarLedgerPruningWorker,
} from "./workers/public/index.js";
import { logSection } from "./lib/logger.js";
import { initializeApiKeyMappings } from "./services/torn-client.js";

type WorkerScope = "private" | "public" | "all";

function resolveWorkerScope(): WorkerScope {
  const raw = (process.env.WORKER_SCOPE || "all").toLowerCase();
  if (raw === "private" || raw === "public" || raw === "all") {
    return raw;
  }

  console.warn(`[Workers] Unknown WORKER_SCOPE '${raw}'. Defaulting to 'all'.`);
  return "all";
}

async function startAllWorkers(): Promise<void> {
  logSection("🚀 Starting Sentinel workers");

  try {
    const scope = resolveWorkerScope();
    logSection(`🧭 Worker scope: ${scope}`);

    // Initialize API key mapping for rate limiting - CRITICAL, must succeed
    logSection("🔐 Initializing rate limiting...");
    await initializeApiKeyMappings(scope);

    if (scope !== "public") {
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

      // Battlestats sync worker (every minute)
      startBattlestatsSyncWorker();

      // Battlestats pruning worker (weekly on Sundays, removes intra-day bloat)
      startBattlestatsPruningWorker();
    }

    if (scope !== "private") {
      // Torn items worker (daily at ~03:00 UTC)
      startTornItemsWorker();

      // Faction sync worker (once daily)
      startFactionSyncWorker();

      // TT module workers
      startTerritoryBlueprintSyncWorker(); // once daily
      startWarLedgerSyncWorker(); // every 15 seconds
      startTerritoryStateSyncWorker(); // dynamic cadence based on API keys

      // Auto-pruning workers
      startRateLimitPruningWorker(); // prune old rate limit entries hourly
      startWarLedgerPruningWorker(); // prune wars older than 95 days daily
    }

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

// Start workers - exits process if rate limiting initialization fails
startAllWorkers().catch((error) => {
  console.error(
    "[CRITICAL] Failed to start workers:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
