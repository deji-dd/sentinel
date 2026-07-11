import { Logger, LedgerEvents, PersonalLogs } from "@sentinel/shared";
import { processLedgerLog } from "../workers/private/ledger/router.js";

const logger = new Logger("ledger_healer");

async function healLedger() {
  logger.info("Starting Ledger Self-Healing Script...");

  // 1. Get Ledger Day Zero Initialization Timestamp
  const initEvent = LedgerEvents.find({ type: "init" });
  if (initEvent.length === 0) {
    logger.error(
      "Ledger has not been initialized. Please start the worker to initialize it first.",
    );
    process.exit(1);
  }

  const initTimestamp = initEvent[0].timestamp;
  logger.info(`Ledger Day Zero Baseline: ${initTimestamp}`);

  // 2. Fetch all personal logs from database that occurred AFTER initialization
  // Note: we can't do simple LokiJS queries like $gte in find() directly if we don't have indexes configured exactly,
  // but we can just filter the results manually for safety.
  const allLogs = PersonalLogs.find({});
  const logsToHeal = allLogs.filter((l) => l.timestamp >= initTimestamp);

  logger.info(
    `Found ${logsToHeal.length} logs in the database since Day Zero.`,
  );

  let healedCount = 0;

  for (const log of logsToHeal) {
    // 3. Check if a ledger event already exists for this log
    const exists = LedgerEvents.find({ log_id: log.id });
    if (exists.length > 0) continue; // Already parsed successfully

    // 4. Try parsing it again! If a parser was added, it will create a new ledger event.
    // processLedgerLog safely handles duplicates and drops them if unhandled.
    await processLedgerLog(log);

    // Verify if it successfully parsed this time
    const checkHealed = LedgerEvents.find({ log_id: log.id });
    if (checkHealed.length > 0) {
      healedCount++;
      logger.info(
        `[HEALED] Successfully recovered log ${log.id} (${log.title})`,
      );
    }
  }

  logger.info(
    `Ledger Self-Healing Complete! Recovered ${healedCount} past logs that now have parser support.`,
  );
  process.exit(0);
}

healLedger().catch((err) => {
  logger.error("Fatal error during ledger healing:", err);
  process.exit(1);
});
