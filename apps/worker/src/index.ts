import { logSection } from "./lib/logger.js";
import { initializeApiKeyMappings } from "./services/torn-client.js";
import { startWorkersForScope, type WorkerScope } from "./workers/registry.js";

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

    const startedCount = startWorkersForScope(scope);
    logSection(`🧩 Started ${startedCount} worker runners`);

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
