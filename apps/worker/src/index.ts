import { initializeNetworkPipelining } from "./lib/network.js";
initializeNetworkPipelining();

// Global process error handlers to prevent crashes on transient network socket drops
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("other side closed") || msg.includes("UND_ERR_SOCKET") || msg.includes("ECONNRESET") || msg.includes("socket hang up")) {
    console.warn("[Process] Gracefully caught transient network socket error:", msg);
  } else {
    console.error("[Process] Uncaught Exception:", err);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled Rejection at:", promise, "reason:", reason);
});

import { logSection } from "./lib/logger.js";
import { initializeApiKeyMappings } from "./services/torn-client.js";
import { initializeRateLimitCache } from "./lib/rate-limit-tracker-per-user.js";
import { startWorkersForScope, type WorkerScope } from "./workers/registry.js";
import { resetStuckWorkerSchedules } from "@sentinel/shared";

function resolveWorkerScope(): WorkerScope {
  const raw = (process.env.WORKER_SCOPE || "all").toLowerCase();
  if (raw === "private" || raw === "public" || raw === "all") {
    return raw;
  }

  console.warn(`[Workers] Unknown WORKER_SCOPE '${raw}'. Defaulting to 'all'.`);
  return "all";
}

async function startAllWorkers(): Promise<void> {
  logSection("Starting Sentinel workers");

  try {
    // Reset any stuck/locked workers from previous runs
    logSection("Resetting stuck worker schedules...");
    const resetCount = await resetStuckWorkerSchedules();
    if (resetCount > 0) {
      console.log(`[Scheduler] Reset ${resetCount} stuck worker schedule(s)`);
    }

    const scope = resolveWorkerScope();
    logSection(`Worker scope: ${scope}`);

    // Initialize API key mapping for rate limiting - CRITICAL, must succeed
    logSection("Initializing rate limiting...");
    await initializeApiKeyMappings(scope);
    await initializeRateLimitCache();
    logSection("Initializing in-memory settings cache...");
    const { settingsCache } = await import("./lib/settings-cache.js");
    await settingsCache.hydrate();
    settingsCache.startWatching();

    const startedCount = startWorkersForScope(scope);
    logSection(`Started ${startedCount} worker runners`);

    logSection("All workers started");
  } catch (error) {
    console.error("Failed to start workers:", error);
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
