import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { workerEvents } from "../../lib/event-bus.js";
import { runCrimesLedgerInit } from "./crimes.js";
import { runGymLedgerInit } from "./gym.js";
import { runStockLedgerInit } from "./stocks.js";
import { runWealthLedgerInit } from "./wealth.js";
import { runTravelLedgerInit } from "./travel.js";

const logger = new Logger("SequentialInits");

let isSequentialInitRunning = false;

/**
 * Runs historical module initializations in strict serial order:
 * 1. Crimes Ledger Init
 * 2. Gym Ledger Init
 * 3. Stock Ledger Init
 * 4. Wealth Engine Init (historical asset & inventory replay)
 * 5. Travel Ledger Init
 */
export async function runSequentialInits(): Promise<void> {
  if (isSequentialInitRunning) return;

  const backfillRecord = await db.systemState.findUnique({
    where: { id: "log_manager_backfill_progress" },
  });
  const backfillData = backfillRecord?.data as { status: string } | undefined;

  if (backfillData?.status !== "completed") {
    return;
  }

  isSequentialInitRunning = true;
  logger.info("--- Starting Sequential Module Initializations Pipeline ---");

  try {
    // 1. Crimes Init
    logger.info("[1/5] Checking Crimes Ledger initialization...");
    await runCrimesLedgerInit();

    // 2. Gym Init
    logger.info("[2/5] Checking Gym Ledger initialization...");
    await runGymLedgerInit();

    // 3. Stock Init
    logger.info("[3/5] Checking Stock Ledger initialization...");
    await runStockLedgerInit();

    // 4. Wealth Init
    logger.info("[4/5] Checking Wealth Engine initialization...");
    await runWealthLedgerInit();

    // 5. Travel Init
    logger.info("[5/5] Checking Travel Ledger initialization...");
    await runTravelLedgerInit();

    logger.info("--- Sequential Module Initializations Pipeline Completed! ---");
  } catch (err) {
    logger.error("Error during sequential module inits pipeline:", err);
  } finally {
    isSequentialInitRunning = false;
  }
}

/**
 * Starts the Sequential Inits Manager:
 * Listens for log_backfill_completed and triggers runSequentialInits().
 */
export function startSequentialInitsManager(): void {
  workerEvents.on("log_backfill_completed", () => {
    runSequentialInits().catch((err) =>
      logger.error("Error running sequential inits after backfill:", err),
    );
  });

  // Also check on boot in case backfill was already completed previously
  runSequentialInits().catch((err) =>
    logger.error("Error running boot sequential inits check:", err),
  );
}
