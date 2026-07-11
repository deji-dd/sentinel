import { Logger, TornSchema } from "@sentinel/shared";
import { workerEvents } from "../../../lib/event-bus.js";
import { LedgerEvents } from "@sentinel/shared";
import { parseStandardCashTransaction } from "./parsers/standard-cash.js";
import { parseStorageTransfer } from "./parsers/storage-transfer.js";
import { parseZeroCostInjection } from "./parsers/zero-cost.js";
import { parseTransformationSink } from "./parsers/sinks.js";
import { parseBarterTrade } from "./parsers/barter.js";
import { parseFactionLiability } from "./parsers/faction.js";
import { parseEquityProperty } from "./parsers/equities.js";

const logger = new Logger("ledger_router");

/**
 * Maps Torn log IDs and categories to the 9 contextual Ledger Categories.
 */
function getLedgerCategoryId(log: TornSchema<"UserLog">): number | null {
  const id = log.details?.id;
  const cat = log.details?.category;

  if (!id || !cat) return null;

  // Category 2: Standard Cash Transactions (Purchases/Sales)
  if (
    [
      1112, 1225, 4200, 4201, 5010, 4320, 1226, 1113, 4210, 4220, 5011, 4322,
    ].includes(id)
  )
    return 2;
  // Also fallback to market categories where cash is exchanged
  if (
    cat === "Item market" ||
    cat === "Points market" ||
    cat === "Shops" ||
    cat === "Auctions"
  )
    return 2;

  // Category 3: Asset State Changes (Escrow / Storage)
  if ([1222, 1302, 1403, 1110, 5000, 4447, 4300, 4700, 4710].includes(id)) return 3;
  if (cat === "Display case" || cat === "Equipping") return 3;

  // Category 4: Zero-Cost Injections (Thin Air Assets)
  if ([5725, 7011, 1404, 6733, 7900, 5530, 5531, 1100, 1102, 1105, 1150, 1200, 4810, 6736, 7033, 7333].includes(id)) return 4;
  if (
    [
      "Crimes",
      "City finds",
      "Dump",
      "Mission rewards",
      "Crime success",
    ].includes(cat)
  )
    return 4;

  // Category 5: Asset Transformations & Sinks
  if ([1104, 1107, 1109, 1111, 1162, 2212, 4800, 5202, 5205].includes(id))
    return 5;
  if (
    cat === "Museum" ||
    cat === "Refills" ||
    cat === "Church" ||
    cat?.startsWith("Item use")
  )
    return 5;

  // Category 6: The Barter System (Asymmetric Trades)
  if ([4430].includes(id)) return 6;
  if (cat === "Trades") return 6;

  // Category 7: Faction Ownership (The Liability)
  if ([6746, 6747, 6728].includes(id)) return 7;

  // Category 9: Equities, Real Estate & Companies
  if ([6300].includes(id)) return 9;
  if (["Stocks", "Property", "Company"].includes(cat)) return 9;

  return null;
}

let initTimestamp: number | null = null;
let processLock: Promise<void> = Promise.resolve();

export async function processLedgerLog(log: TornSchema<"UserLog">) {
  // Wait for the lock if another log is being processed
  await processLock;

  let releaseLock: () => void = () => {};
  processLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  try {
    // 0. Ensure we don't process logs that occurred before the Ledger's Day Zero Initialization
    if (initTimestamp === null) {
      const initEvent = LedgerEvents.find({ type: "init" });
      if (initEvent.length > 0) {
        initTimestamp = initEvent[0].timestamp;
      } else {
        // Fallback to start of current day if no init event found
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        initTimestamp = Math.floor(now.getTime() / 1000);
      }
    }

    if (log.timestamp < initTimestamp) {
      // Ignore deeply historical logs
      return;
    }

    // 1. Filter out already processed logs (Duplicate Check)
    const exists = LedgerEvents.find({ log_id: log.id });
    if (exists.length > 0) {
      return; // Already parsed
    }

    const ledgerCat = getLedgerCategoryId(log);
    if (!ledgerCat) return; // Unhandled log

    switch (ledgerCat) {
      case 2:
        await parseStandardCashTransaction(log);
        break;
      case 3:
        await parseStorageTransfer(log);
        break;
      case 4:
        await parseZeroCostInjection(log);
        break;
      case 5:
        await parseTransformationSink(log);
        break;
      case 6:
        await parseBarterTrade(log);
        break;
      case 7:
        await parseFactionLiability(log);
        break;
      case 9:
        await parseEquityProperty(log);
        break;
    }
  } catch (error) {
    logger.error(`Failed to parse ledger event for log ${log.id}:`, error);
  } finally {
    releaseLock();
  }
}

export function startLedgerRouter() {
  logger.info("Starting Ledger Event Router...");

  workerEvents.on("NEW_PERSONAL_LOG", processLedgerLog);
  workerEvents.on("HISTORICAL_PERSONAL_LOG", processLedgerLog);
}
