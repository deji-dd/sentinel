import { Logger } from "@sentinel/shared";
import { initializeLedgerBaseline } from "./init.js";
import { startLedgerRouter } from "./router.js";

const logger = new Logger("ledger");

export function startLedgerWorker(): void {
  logger.info("Starting Ledger Worker...");

  // Run initialization in the background
  initializeLedgerBaseline().catch((err) => {
    logger.error("Failed to initialize ledger:", err);
  });

  // Start the Central Event Router (Phase 3)
  startLedgerRouter();
}
