import {
  Logger,
  LedgerEvents,
  PersonalLogs,
  SystemState,
  SystemStateDocument,
} from "@sentinel/shared";
import { WEALTH_LOG_ROUTES } from "../workers/private/wealth.js"; // <-- Import your V2 router!

const logger = new Logger("ledger_healer");

type InitState = Extract<SystemStateDocument, { timestamp: number }>;

export async function healLedger() {
  logger.info("Starting V2 Ledger Self-Healing Script...");

  // 1. Get Ledger Initialization Timestamp
  const itemsInitState = SystemState.find<InitState>({
    id: "wealth_ledger_v2_init",
  })[0];
  if (!itemsInitState) {
    logger.error(
      "Ledger has not been initialized. Please run Day Zero sync first.",
    );
    process.exit(1);
  }
  const itemsInitTimestamp = itemsInitState.timestamp;
  logger.info(`Ledger Baseline: ${itemsInitTimestamp}`);

  // 2. Fetch all logs AFTER the baseline
  const allLogs = PersonalLogs.find({});
  const logsToHeal = allLogs.filter((l) => l.timestamp > itemsInitTimestamp);

  logger.info(`Scanning ${logsToHeal.length} logs since Baseline...`);

  let healedCount = 0;

  // 3. Process Missed Logs
  for (const log of logsToHeal) {
    // Skip if a ledger event already exists
    const exists = LedgerEvents.find({ log_id: log.id });
    if (exists.length > 0) continue;

    // Check if our V2 router supports this log type now
    const logId = log.details.id as keyof typeof WEALTH_LOG_ROUTES;
    const routes = WEALTH_LOG_ROUTES[logId];

    if (routes && routes.length > 0) {
      // Feed it through the strict V2 parsers
      for (const routeFn of routes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        routeFn(log as any);
      }

      // Verify if the parser successfully emitted an event
      const checkHealed = LedgerEvents.find({ log_id: log.id });
      if (checkHealed.length > 0) {
        healedCount++;
        logger.info(
          `[HEALED] Successfully recovered log ${log.id} (Type: ${logId})`,
        );
      }
    }
  }

  logger.info(
    `Ledger Self-Healing Complete! Recovered ${healedCount} past logs.`,
  );
}

// Auto-run execution wrapper
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.includes("heal-ledger")
) {
  healLedger()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("Fatal error during ledger healing:", err);
      process.exit(1);
    });
}
