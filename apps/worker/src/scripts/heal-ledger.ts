import {
  Logger,
  LedgerEvents,
  PersonalLogs,
  Assets,
  TornItems,
  SystemState,
  SystemStateDocument,
} from "@sentinel/shared";
import {
  parseStandardCash,
  parseEquityProperty,
  parseStorageTransfer,
  parseZeroCostInjection,
  parseTransformationSink,
  parseBarterTrade,
  parseFactionLiability,
  parseCompanyProfit,
} from "../workers/private/wealth.js";

const logger = new Logger("ledger_healer");

type InitState = Extract<SystemStateDocument, { timestamp: number }>;

export async function healLedger() {
  logger.info("Starting Ledger Self-Healing Script...");

  // 1. Get Ledger Initialization Timestamps
  const itemsInitState = SystemState.find<InitState>({
    id: "items_ledger_init_state",
  })[0];
  if (!itemsInitState) {
    logger.error(
      "Items Ledger has not been initialized. Please start the worker first.",
    );
    process.exit(1);
  }
  const itemsInitTimestamp = itemsInitState.timestamp;
  logger.info(`Items Ledger Baseline: ${itemsInitTimestamp}`);

  // We fetch logs that are strictly AFTER the init timestamp
  const allLogs = PersonalLogs.find({});
  const logsToHeal = allLogs.filter((l) => l.timestamp > itemsInitTimestamp);

  logger.info(
    `Found ${logsToHeal.length} logs in the database since Baseline.`,
  );

  let healedCount = 0;

  for (const log of logsToHeal) {
    // 3. Check if a ledger event already exists for this log
    // We only heal parsers that emit LedgerEvents! (Company Profit + Items Ledger)
    // Crimes are intentionally excluded because they don't emit LedgerEvents and would double-count.
    const exists = LedgerEvents.find({ log_id: log.id });
    if (exists.length > 0) continue; // Already parsed successfully

    const logType = log.details.id;
    const logCategory = log.details.category;

    // 4. Dispatch exactly like log-manager
    let parsed = false;

    if (logType === 6222) {
      await parseCompanyProfit(log);
      parsed = true;
    } else if (
      [
        1112, 1225, 4200, 4201, 5010, 4320, 1226, 1113, 4210, 4220, 5011, 4322,
      ].includes(logType) ||
      ["Item market", "Points market", "Shops", "Auctions"].includes(
        logCategory,
      )
    ) {
      parseStandardCash(log);
      parsed = true;
    } else if (
      [1222, 1302, 1403, 1110, 5000, 4447, 4300, 4700, 4710].includes(
        logType,
      ) ||
      ["Display case", "Equipping"].includes(logCategory)
    ) {
      parseStorageTransfer(log);
      parsed = true;
    } else if (
      [
        5725, 7011, 1404, 6733, 7900, 5530, 5531, 1100, 1102, 1105, 1150, 1200,
        4810, 6736, 7033, 7333,
      ].includes(logType) ||
      [
        "Crimes",
        "City finds",
        "Dump",
        "Mission rewards",
        "Crime success",
      ].includes(logCategory)
    ) {
      parseZeroCostInjection(log);
      parsed = true;
    } else if (
      [1104, 1107, 1109, 1111, 1162, 2212, 4800, 5202, 5205].includes(
        logType,
      ) ||
      ["Museum", "Refills", "Church", "Item use"].includes(logCategory)
    ) {
      parseTransformationSink(log);
      parsed = true;
    } else if ([4430].includes(logType) || ["Trades"].includes(logCategory)) {
      parseBarterTrade(log);
      parsed = true;
    } else if ([6746, 6747, 6728].includes(logType)) {
      parseFactionLiability(log);
      parsed = true;
    } else if (
      [6300].includes(logType) ||
      ["Stocks", "Property", "Company"].includes(logCategory)
    ) {
      parseEquityProperty(log);
      parsed = true;
    }

    if (parsed) {
      // Verify if it successfully parsed this time
      const checkHealed = LedgerEvents.find({ log_id: log.id });
      if (checkHealed.length > 0) {
        healedCount++;
        logger.info(
          `[HEALED] Successfully recovered log ${log.id} (${log.details.title})`,
        );
      }
    }
  }

  // 5. Heal Zero-Cost Day Zero Items
  logger.info("Checking for zero-cost initialized assets...");
  const zeroCostAssets = Assets.find({
    origin: "legacy_init",
    moving_average_cost: 0,
  });
  let fixedAssets = 0;

  if (zeroCostAssets.length > 0) {
    logger.info(
      `Found ${zeroCostAssets.length} zero-cost legacy items. Attempting to fetch market prices...`,
    );
    for (const asset of zeroCostAssets) {
      if (asset.type === "item") {
        const itemRecord = TornItems.findFirst(
          (doc) => doc.data.id === Number(asset.asset_id),
        );
        if (itemRecord && itemRecord.data.value?.market_price) {
          const marketPrice = itemRecord.data.value.market_price;
          asset.moving_average_cost = marketPrice;
          asset.total_cost_basis = marketPrice * asset.quantity;
          asset.last_updated = Date.now();
          Assets.update(asset);
          fixedAssets++;
        }
      }
    }
    logger.info(
      `Successfully healed ${fixedAssets} legacy items with proper market values!`,
    );
  }

  // 6. Heal Ledger Events with 0 cost basis impact for consumed items
  logger.info("Healing Ledger Events with 0 cost basis impact...");
  const allEvents = LedgerEvents.find({});
  let fixedEvents = 0;
  for (const event of allEvents) {
    // Re-parse completely broken events (missing assets_affected)
    if (!event.assets_affected || event.assets_affected.length === 0) {
      if (event.category_id === 2 || event.category_id === 9) {
        if (event.category_id === 2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parseStandardCash(event.raw_log as any);
        } else if (event.category_id === 9) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parseEquityProperty(event.raw_log as any);
        }
        continue;
      }
      continue;
    }

    let needsUpdate = false;
    for (const affected of event.assets_affected) {
      if (affected.cost_basis_impact === 0 && affected.quantity_change !== 0) {
        const itemRecord = TornItems.findFirst(
          (doc) => doc.data.id === Number(affected.asset_id),
        );
        if (itemRecord && itemRecord.data.value?.market_price) {
          affected.cost_basis_impact =
            itemRecord.data.value.market_price * affected.quantity_change;
          needsUpdate = true;
        }
      }
    }
    if (needsUpdate) {
      LedgerEvents.update(event);
      fixedEvents++;
    }
  }
  logger.info(
    `Successfully healed ${fixedEvents} Ledger Events retroactively!`,
  );

  logger.info(
    `Ledger Self-Healing Complete! Recovered ${healedCount} past logs that now have parser support.`,
  );
}

// Only auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes("heal-ledger")) {
  healLedger()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("Fatal error during ledger healing:", err);
      process.exit(1);
    });
}
