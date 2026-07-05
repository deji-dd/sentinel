/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";

const WORKER_NAME = "torn_finance_logs_worker";
const logger = new Logger(WORKER_NAME);

const FINANCE_LOG_CATEGORIES = new Set([
  "bazaars",
  "item market",
  "itemmarket",
  "stocks",
  "stocks incoming",
  "stocks outgoing",
  "stock specials",
  "company",
  "company outgoing",
  "company incoming",
  "company special",
  "crimes",
  "crime success",
  "attacking",
  "attacks outgoing",
  "attacks incoming",
  "faction",
  "faction outgoing",
  "faction incoming",
  "faction payout",
  "upkeep",
  "loan",
  "drugs",
  "item use drug",
  "item use booster",
  "item use medical",
  "item use alcohol",
  "item use candy",
  "points",
  "points outgoing",
  "points incoming",
  "points building",
  "points market",
  "pointsmarket",
  "money",
  "money transfer",
  "moneytransfer",
  "bounties",
  "bounty",
  "missions",
  "shops",
  "property"
]);

const STOCK_ACRONYM_TO_ID: Record<string, number> = {
  TCG: 1, TCI: 2, LSC: 3, TGP: 4, TGB: 5, TYC: 6, WSU: 7, TSU: 8,
  TCB: 9, WLT: 10, GRN: 11, SYS: 12, FHG: 13, IIL: 14, MCS: 15,
  PTS: 16, CAC: 17, CNC: 18, EVL: 19, PRN: 20, SHS: 21, SYM: 22,
  TDM: 23, TPF: 24, TJI: 25, MSG: 26, HRG: 27, ASS: 28, ELT: 29,
  IIL2: 30
};

interface ParsedPayout {
  ticker: string;
  payoutType: "cash" | "points" | "stats" | "items";
  quantity: number;
  value: number;
  itemDetails: Record<string, { quantity: number; unit_price: number; total_value: number }>;
}

async function findHistoricalAcquisitionCost(db: any, itemId: number): Promise<number | null> {
  try {
    // 1. Search for buy/purchase transactions in raw logs
    const buyLogs = await db
      .selectFrom(TABLE_NAMES.USER_LOGS as any)
      .select(["data"])
      .where((eb: any) =>
        eb.or([
          eb("category", "=", "bazaars"),
          eb("category", "=", "itemmarket"),
          eb("category", "=", "item market"),
          eb("title", "like", "%buy%"),
          eb("title", "like", "%purchase%")
        ])
      )
      .orderBy("timestamp", "desc")
      .limit(20)
      .execute();

    for (const log of buyLogs) {
      const logData = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      const loggedItemId = Number(logData.item || logData.item_id || logData.id || 0);
      if (loggedItemId === itemId) {
        const price = Number(logData.price || logData.cost || logData.total_cost || logData.cost_total || 0);
        if (price > 0) {
          return price;
        }
      }
    }

    // 2. Search for zero-cost acquisitions (crimes, city finds, faction payouts)
    const freeLogs = await db
      .selectFrom(TABLE_NAMES.USER_LOGS as any)
      .select(["data"])
      .where((eb: any) =>
        eb.or([
          eb("category", "like", "%crime%"),
          eb("title", "like", "%city find%"),
          eb("title", "like", "%faction%"),
          eb("category", "like", "%faction%")
        ])
      )
      .orderBy("timestamp", "desc")
      .limit(30)
      .execute();

    for (const log of freeLogs) {
      const logData = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      if (logData.items_gained && typeof logData.items_gained === "object") {
        if (String(itemId) in logData.items_gained) {
          return 0;
        }
      }
      const loggedItemId = Number(logData.item || logData.item_id || logData.id || 0);
      if (loggedItemId === itemId) {
        return 0;
      }
    }
  } catch {}
  return null;
}

function parseStockPayoutLog(
  log: any,
  itemPriceMap: Map<number, number>,
  pointPrice: number,
  itemMap: Map<number, { name: string; value: number }>
): ParsedPayout | null {
  const title = String(log.title || "").toLowerCase();
  let logData: any = {};
  try {
    logData = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
  } catch {
    logData = {};
  }

  const logIdNum = Number(log.details?.id || log.log || log.id_num || 0);

  let stockId = Number(logData.stock || 0);
  if (!stockId) {
    let ticker = (logData.stock_acronym || logData.stock || logData.ticker || "").toUpperCase();
    if (!ticker) {
      const match = title.match(/\b([A-Z]{3,4})\b/);
      if (match) ticker = match[1].toUpperCase();
    }
    if (ticker) {
      stockId = STOCK_ACRONYM_TO_ID[ticker] || 0;
    }
  }

  if (!stockId) return null;

  let payoutType: "cash" | "points" | "stats" | "items" | null = null;
  let quantity = 0;
  let value = 0;
  const itemDetails: Record<string, { quantity: number; unit_price: number; total_value: number }> = {};

  if (logIdNum === 5530 || logIdNum === 5533 || logIdNum === 5536 || logIdNum === 5537 || logData.item) {
    payoutType = "items";
    if (logData.item && typeof logData.item === "object") {
      for (const [key, qty] of Object.entries(logData.item)) {
        const itemId = Number(key);
        const q = Number(qty || 1);
        quantity += q;
        const unitPrice = itemPriceMap.get(itemId) || 0;
        value += unitPrice * q;
        
        const itemInfo = itemMap.get(itemId);
        const name = itemInfo?.name || `Item #${itemId}`;
        itemDetails[name] = {
          quantity: q,
          unit_price: unitPrice,
          total_value: unitPrice * q
        };
      }
    } else {
      const itemId = Number(logData.item || logData.item_id || 0);
      if (itemId) {
        const q = Number(logData.quantity || logData.qty || 1);
        quantity = q;
        const unitPrice = itemPriceMap.get(itemId) || 0;
        value = unitPrice * q;
        const itemInfo = itemMap.get(itemId);
        const name = itemInfo?.name || `Item #${itemId}`;
        itemDetails[name] = {
          quantity: q,
          unit_price: unitPrice,
          total_value: value
        };
      }
    }
  }
  else if (logIdNum === 5531 || logData.points || logData.points_increased || logData.points_gained) {
    payoutType = "points";
    quantity = Number(logData.points || logData.points_increased || logData.points_gained || 0);
    value = quantity * pointPrice;
    itemDetails["Points"] = {
      quantity,
      unit_price: pointPrice,
      total_value: value
    };
  }
  else if (logIdNum === 5532 || logData.money || logData.money_gained || logData.dividend || logData.cash) {
    payoutType = "cash";
    quantity = Number(logData.money || logData.money_gained || logData.dividend || logData.cash || 0);
    value = quantity;
    itemDetails["Cash"] = {
      quantity,
      unit_price: 1,
      total_value: value
    };
  }
  else if (logIdNum === 5534 || logIdNum === 5535 || logData.energy_increased || logData.nerve_increased || logData.happy_increased || logData.energy || logData.nerve || logData.happy) {
    payoutType = "stats";
    const energy = Number(logData.energy_increased || logData.energy || 0);
    const nerve = Number(logData.nerve_increased || logData.nerve || 0);
    const happy = Number(logData.happy_increased || logData.happy || 0);

    if (energy > 0) {
      quantity = energy;
      value = 0;
      itemDetails["Energy"] = {
        quantity,
        unit_price: 0,
        total_value: 0
      };
    } else if (nerve > 0) {
      quantity = nerve;
      value = 0;
      itemDetails["Nerve"] = {
        quantity,
        unit_price: 0,
        total_value: 0
      };
    } else if (happy > 0) {
      quantity = happy;
      value = 0;
      itemDetails["Happiness"] = {
        quantity,
        unit_price: 0,
        total_value: 0
      };
    }
  }

  if (!payoutType || quantity <= 0) return null;

  return {
    ticker: String(stockId),
    payoutType,
    quantity,
    value,
    itemDetails
  };
}

async function processStockPayoutsForLogs(db: any, logs: any[]): Promise<void> {
  const items = await db
    .selectFrom(TABLE_NAMES.TORN_ITEMS)
    .select(["item_id", "value", "name"])
    .execute()
    .catch(() => []);

  const itemPriceMap = new Map<number, number>();
  const itemMap = new Map<number, { name: string; value: number }>();
  for (const item of items) {
    const itemId = Number(item.item_id);
    const val = Number(item.value || 0);
    itemPriceMap.set(itemId, val);
    itemMap.set(itemId, { name: String(item.name || ""), value: val });
  }

  const pointPriceRow = await db
    .selectFrom("sentinel_market_prices")
    .select("value")
    .where("key", "=", "points")
    .executeTakeFirst();
  const pointPrice = Number(pointPriceRow?.value || 45000);

  for (const log of logs) {
    const titleLower = String(log.title || "").toLowerCase();
    const categoryLower = String(log.category || "").toLowerCase();
    let data: any = {};
    try {
      data = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
    } catch {}

    const logIdNum = Number(data.details?.id || data.log || 0);
    const isStockLog = (logIdNum >= 5530 && logIdNum <= 5537) || categoryLower === "134" || categoryLower.includes("stock") || titleLower.includes("dividend") || titleLower.includes("benefit");

    if (!isStockLog) continue;

    const logWithDetails = {
      ...log,
      details: { id: logIdNum },
      data
    };

    const parsed = parseStockPayoutLog(logWithDetails, itemPriceMap, pointPrice, itemMap);
    if (!parsed) continue;

    const { ticker: stockIdStr, payoutType, quantity, value, itemDetails } = parsed;
    const stockId = Number(stockIdStr);

    if (stockId > 0) {
      const alreadyProcessed = await db
        .selectFrom("sentinel_processed_benefit_logs")
        .select("log_id")
        .where("log_id", "=", String(log.log_id))
        .executeTakeFirst();

      if (alreadyProcessed) continue;

      const existing = await db
        .selectFrom("sentinel_stock_benefit_payouts")
        .selectAll()
        .where("stock_id", "=", stockId)
        .where("benefit_type", "=", payoutType)
        .executeTakeFirst();

      if (existing) {
        let mergedItemDetails: Record<string, any> = {};
        try {
          const prevDetails = JSON.parse(existing.item_details || "{}");
          mergedItemDetails = { ...prevDetails };
          for (const [itemName, itemInfo] of Object.entries(itemDetails) as any[]) {
            if (mergedItemDetails[itemName]) {
              const currentQty = mergedItemDetails[itemName].quantity + itemInfo.quantity;
              mergedItemDetails[itemName] = {
                quantity: currentQty,
                unit_price: itemInfo.unit_price,
                total_value: currentQty * itemInfo.unit_price
              };
            } else {
              mergedItemDetails[itemName] = itemInfo;
            }
          }
        } catch {
          mergedItemDetails = itemDetails;
        }

        await db
          .updateTable("sentinel_stock_benefit_payouts")
          .set({
            quantity: Number(existing.quantity) + quantity,
            value_accumulated: Number(existing.value_accumulated) + value,
            item_details: JSON.stringify(mergedItemDetails),
            updated_at: new Date().toISOString(),
          })
          .where("stock_id", "=", stockId)
          .where("benefit_type", "=", payoutType)
          .execute();
      } else {
        await db
          .insertInto("sentinel_stock_benefit_payouts")
          .values({
            stock_id: stockId,
            benefit_type: payoutType,
            quantity,
            value_accumulated: value,
            item_details: JSON.stringify(itemDetails),
            updated_at: new Date().toISOString(),
          })
          .execute();
      }

      await db
        .insertInto("sentinel_processed_benefit_logs" as any)
        .values({
          log_id: String(log.log_id),
          processed_at: new Date().toISOString(),
        })
        .onConflict((oc: any) => oc.column("log_id").doNothing())
        .execute();
    }
  }
}

export async function syncFinanceLogs(): Promise<void> {
  const db = getKysely();

  // Wait for central_log_manager backfill to complete first
  const scheduleRow = await db
    .selectFrom("sentinel_worker_schedules as s")
    .innerJoin("sentinel_workers as w", "s.worker_id", "w.id")
    .select("s.metadata")
    .where("w.name", "=", "central_log_manager")
    .executeTakeFirst();

  let isBackfilling = true;
  if (scheduleRow?.metadata) {
    try {
      const parsed = JSON.parse(scheduleRow.metadata);
      if (parsed.backfill_complete) {
        isBackfilling = false;
      }
    } catch {}
  }

  if (isBackfilling) {
    logger.info("Central Log Manager backfill in progress. Deferring run...");
    return;
  }

  const latestLog = await db
    .selectFrom("sentinel_financial_logs" as any)
    .select("timestamp")
    .orderBy("timestamp", "desc")
    .limit(1)
    .executeTakeFirst();

  // If first startup, start parsing raw logs from 00:00 TCT of today onwards
  let fromTimestamp = latestLog ? Number(latestLog.timestamp) : 0;
  if (fromTimestamp === 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    fromTimestamp = Math.floor(todayStart.getTime() / 1000);
  }

  logger.info(`Syncing financial logs from local DB since timestamp ${fromTimestamp}...`);

  try {
    const rawLogs = await db
      .selectFrom(TABLE_NAMES.USER_LOGS as any)
      .selectAll()
      .where("timestamp", ">", fromTimestamp)
      .orderBy("timestamp", "asc")
      .execute();

    if (rawLogs.length === 0) {
      logger.info("No new local logs to parse.");
      return;
    }

    const items = await db
      .selectFrom(TABLE_NAMES.TORN_ITEMS)
      .select(["item_id", "value"])
      .execute()
      .catch(() => []);

    const itemPriceMap = new Map<number, number>();
    for (const item of items) {
      itemPriceMap.set(Number(item.item_id), Number(item.value || 0));
    }

    let parsedCount = 0;
    const parsedLogsList: any[] = [];

    for (const log of rawLogs) {
      const logId = String(log.log_id);
      const timestamp = Number(log.timestamp);
      const category = String(log.category || "");
      const title = String(log.title || "");
      let data: any = {};
      try {
        data = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      } catch {}

      const catLower = category.toLowerCase();
      const titleLower = title.toLowerCase();
      const logIdNum = Number(data.details?.id || data.log || 0);
      const isRehab = logIdNum === 6005 || titleLower === "rehab";
      const isBounty = logIdNum === 6700 || logIdNum === 6710 || catLower === "bounties" || catLower === "bounty";
      const isStockSpecialLog = (logIdNum >= 5530 && logIdNum <= 5537) || catLower === "134" || catLower.includes("stock");
      const isTrade = catLower === "trades" || (logIdNum >= 4400 && logIdNum <= 4499);

      if (!FINANCE_LOG_CATEGORIES.has(catLower) && !catLower.includes("item use") && !isRehab && !isBounty && !isStockSpecialLog && !isTrade) {
        continue;
      }

      const isItemUse = catLower.includes("item use") || catLower === "drugs" || catLower === "drug";
      if (isItemUse) {
        const itemId = Number(data.item || data.item_id || data.id || 0);
        if (itemId) {
          // Crawl through log history to retrieve acquisition price
          const acqCost = await findHistoricalAcquisitionCost(db, itemId);
          if (acqCost !== null) {
            data.historical_item_value = acqCost;
          } else if (itemPriceMap.has(itemId)) {
            data.historical_item_value = itemPriceMap.get(itemId);
          }
        }
      }

      const isCrime = catLower === "crimes" || titleLower.includes("crime");
      if (isCrime && data.items_gained && typeof data.items_gained === "object") {
        const historicalValues: Record<string, number> = {};
        for (const itemIdStr of Object.keys(data.items_gained)) {
          const itemId = Number(itemIdStr);
          if (itemId) {
            const acqCost = await findHistoricalAcquisitionCost(db, itemId);
            if (acqCost !== null) {
              historicalValues[itemIdStr] = acqCost;
            } else if (itemPriceMap.has(itemId)) {
              historicalValues[itemIdStr] = itemPriceMap.get(itemId) || 0;
            }
          }
        }
        data.historical_item_values = historicalValues;
      }

      await db
        .insertInto("sentinel_financial_logs" as any)
        .values({
          log_id: logId,
          timestamp,
          category,
          title,
          data: JSON.stringify(data),
        })
        .onConflict((oc: any) => oc.column("log_id").doNothing())
        .execute();

      parsedCount++;
      parsedLogsList.push(log);
    }

    if (parsedLogsList.length > 0) {
      await processStockPayoutsForLogs(db, parsedLogsList);
    }

    if (parsedCount > 0) {
      logger.success(`Successfully parsed and saved ${parsedCount} financial logs.`);
    } else {
      logger.info("No new financial logs found in crawled set.");
    }
  } catch (error) {
    logger.error("Failed syncing finance logs from local DB", error);
  }
}

export function startTornFinanceLogsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 60, // Run every minute to sync from local raw logs
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 60000,
        handler: syncFinanceLogs,
      });
    },
  });
}
