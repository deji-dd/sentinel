import {
  Logger,
  LedgerEvents,
  PersonalLogs,
  Assets,
  TornItems,
} from "@sentinel/shared";
import { parseStandardCashTransaction } from "../workers/private/ledger/parsers/standard-cash.js";
import { parseEquityProperty } from "../workers/private/ledger/parsers/equities.js";
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
        `[HEALED] Successfully recovered log ${log.id} (${log.details.title})`,
      );
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
      `Found ${zeroCostAssets.length} zero-cost legacy items. Attempting to fetch market prices from TornItems...`,
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
  let healedEvents = 0;
  for (const event of allEvents) {
    // Re-parse completely broken events (missing assets_affected)
    if (!event.assets_affected || event.assets_affected.length === 0) {
      if (event.category_id === 2 || event.category_id === 9) {
        if (event.category_id === 2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await parseStandardCashTransaction(event.raw_log as any);
        } else if (event.category_id === 9) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await parseEquityProperty(event.raw_log as any);
        }
        healedEvents++;
        continue;
      }
      continue;
    }

    let needsUpdate = false;
    for (const affected of event.assets_affected) {
      if (affected.cost_basis_impact === 0 && affected.quantity_change !== 0) {
        // Find if this item has a market price
        const itemRecord = TornItems.findFirst(
          (doc) => doc.data.id === Number(affected.asset_id),
        );
        if (itemRecord && itemRecord.data.value?.market_price) {
          // cost_basis_impact is (market_price * quantity_change) since quantity_change carries the sign
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
  process.exit(0);
}

healLedger().catch((err) => {
  logger.error("Fatal error during ledger healing:", err);
  process.exit(1);
});
