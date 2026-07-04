/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";

const LOGS_WORKER_NAME = "torn_finance_logs_worker";
const PORTFOLIO_WORKER_NAME = "torn_portfolio_worker";

const logsLogger = new Logger(LOGS_WORKER_NAME);
const portfolioLogger = new Logger(PORTFOLIO_WORKER_NAME);

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
  "bounties",
  "bounty"
]);

// Hardcoded fallback mapping of stock acronym to ID
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

/**
 * Parses a stock payout log and extracts benefit details.
 */
function parseStockPayoutLog(
  log: any,
  itemPriceMap: Map<number, number>,
  pointPrice: number,
  itemMap: Map<number, { name: string; value: number }>
): ParsedPayout | null {
  const _category = String(log.category || "").toLowerCase();
  const title = String(log.title || "").toLowerCase();
  let logData: any = {};
  try {
    logData = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
  } catch {
    logData = {};
  }

  const logIdNum = Number(log.details?.id || log.log || 0);

  // Identify stock ID
  let stockId = Number(logData.stock || 0);
  if (!stockId) {
    // Try ticker fallback if stock ID is missing
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

  // 1. Items Payout (5530, 5533, 5536, 5537) or logData.item is set
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
  // 2. Points Payout (5531) or logData.points / points_increased is set
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
  // 3. Cash Payout (5532) or logData.money / money_gained / dividend / cash is set
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
  // 4. Stats Payout (5534, 5535) or stats fields are set
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
    ticker: String(stockId), // Storing stock_id as the ticker temporarily to pass it up
    payoutType,
    quantity,
    value,
    itemDetails
  };
}

/**
 * Processes stock benefit payouts from logs.
 */
export async function processStockBenefitPayouts(db: any): Promise<number> {
  // Fetch all stock logs that haven't been processed
  const unprocessedLogs = await db
    .selectFrom("sentinel_financial_logs as l")
    .leftJoin("sentinel_processed_benefit_logs as p", "l.log_id", "p.log_id")
    .selectAll("l")
    .where("p.log_id", "is", null)
    .where((eb: any) =>
      eb.or([
        eb("l.category", "like", "%stock%"),
        eb("l.title", "like", "%dividend%"),
        eb("l.title", "like", "%benefit%"),
        eb("l.category", "=", "134")
      ])
    )
    .orderBy("l.timestamp", "asc")
    .execute() as any[];

  if (unprocessedLogs.length === 0) {
    return 0;
  }

  logsLogger.info(`[Payout Processor] Processing ${unprocessedLogs.length} unprocessed stock logs.`);

  // Load point price
  const marketPrices = await db
    .selectFrom(TABLE_NAMES.MARKET_PRICES)
    .select(["key", "value"])
    .execute()
    .catch(() => []);
  const priceMap = new Map<string, number>();
  for (const row of marketPrices || []) {
    priceMap.set(row.key ?? "", Number(row.value));
  }
  const pointPrice = priceMap.get("points") ?? 31000;

  // Load item prices & names
  const items = await db
    .selectFrom("sentinel_torn_items")
    .select(["item_id", "name", "value"])
    .execute()
    .catch(() => []);
  const itemPriceMap = new Map<number, number>();
  const itemMap = new Map<number, { name: string; value: number }>();
  for (const item of items) {
    itemPriceMap.set(Number(item.item_id), Number(item.value || 0));
    itemMap.set(Number(item.item_id), { name: item.name, value: Number(item.value || 0) });
  }

  let processedCount = 0;

  for (const log of unprocessedLogs) {
    const parsed = parseStockPayoutLog(log, itemPriceMap, pointPrice, itemMap);
    if (!parsed) {
      // Mark as processed anyway to avoid scanning again
      await db
        .insertInto("sentinel_processed_benefit_logs")
        .values({ log_id: log.log_id })
        .onConflict((oc: any) => oc.column("log_id").doNothing())
        .execute();
      continue;
    }

    const { ticker: stockIdStr, payoutType, quantity, value, itemDetails } = parsed;
    const stockId = Number(stockIdStr);

    if (stockId > 0) {
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
      processedCount++;
    }

    // Mark log as processed
    await db
      .insertInto("sentinel_processed_benefit_logs")
      .values({ log_id: log.log_id })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .execute();
  }

  return processedCount;
}

/**
 * Dynamically backfills stock payout logs for the past 30 days.
 */
export async function backfillStockLogs(db: any, apiKey: string): Promise<void> {
  const backfillCompleted = await db
    .selectFrom("sentinel_processed_benefit_logs")
    .select("log_id")
    .where("log_id", "=", "backfill_completed")
    .executeTakeFirst();

  const now = Math.floor(Date.now() / 1000);
  let startTimestamp = now - 30 * 24 * 60 * 60; // default 30 days

  // Fetch user stocks to find when the oldest stock was bought
  try {
    const userStocks = await tornApi.get("/user/stocks" as any, { apiKey }) as any;
    if (userStocks?.stocks) {
      let minTxTime = now;
      for (const holding of userStocks.stocks) {
        const txs = holding.transactions || [];
        for (const tx of txs) {
          const t = Number(tx.time || tx.timestamp || 0);
          if (t > 0 && t < minTxTime) {
            minTxTime = t;
          }
        }
      }
      if (minTxTime < now && minTxTime > 0) {
        startTimestamp = minTxTime;
        logsLogger.info(`[Backfill] Found oldest stock purchase transaction at ${new Date(startTimestamp * 1000).toISOString()}`);
      }
    }
  } catch (err) {
    logsLogger.error("[Backfill] Failed to fetch user stocks for oldest purchase date:", err);
  }

  if (!backfillCompleted) {
    logsLogger.info(`[Backfill] Starting historical stock logs backfill since ${new Date(startTimestamp * 1000).toLocaleDateString()}...`);

    let currentTo = now;
    let hasMore = true;
    let pages = 0;
    const MAX_PAGES = 100; // fetch up to 100 pages (10,000 logs)

    while (hasMore && pages < MAX_PAGES) {
      try {
        logsLogger.info(`[Backfill] Fetching historical stock logs (page ${pages + 1})...`);
        const response = await tornApi.get("/user/log" as any, {
          apiKey,
          queryParams: {
            from: String(startTimestamp),
            to: String(currentTo),
            limit: "100",
            cat: "95" // Stocks category
          }
        }) as any;

        const logs = response?.log;
        if (!logs || !Array.isArray(logs) || logs.length === 0) {
          break;
        }

        await saveLogBatch(db, logs);

        if (logs.length < 100) {
          hasMore = false;
        } else {
          const oldestInBatch = logs[logs.length - 1];
          currentTo = Number(oldestInBatch.timestamp) - 1;
          if (currentTo < startTimestamp) {
            hasMore = false;
          }
        }

        pages++;
        if (hasMore && pages < MAX_PAGES) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (apiError) {
        logsLogger.error("[Backfill] Failed fetching historical logs page:", apiError);
        hasMore = false;
      }
    }

    // Mark backfill as completed
    await db
      .insertInto("sentinel_processed_benefit_logs")
      .values({
        log_id: "backfill_completed",
        processed_at: new Date().toISOString()
      })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .execute();

    logsLogger.success("[Backfill] Historical stock logs backfill completed.");
  }

  // Specials Backfill (log IDs 5530-5537)
  const backfillSpecialsCompleted = await db
    .selectFrom("sentinel_processed_benefit_logs")
    .select("log_id")
    .where("log_id", "=", "backfill_specials_completed")
    .executeTakeFirst();

  if (!backfillSpecialsCompleted) {
    logsLogger.info(`[Backfill] Starting historical stock specials backfill since ${new Date(startTimestamp * 1000).toLocaleDateString()}...`);
    let currentSpecialsTo = now;
    let specialsHasMore = true;
    let specialsPages = 0;
    const MAX_SPECIALS_PAGES = 100;

    while (specialsHasMore && specialsPages < MAX_SPECIALS_PAGES) {
      try {
        logsLogger.info(`[Backfill] Fetching historical stock specials (page ${specialsPages + 1})...`);
        const response = await tornApi.get("/user/log" as any, {
          apiKey,
          queryParams: {
            from: String(startTimestamp),
            to: String(currentSpecialsTo),
            limit: "100",
            log: "5530,5531,5532,5533,5534,5535,5536,5537"
          }
        }) as any;

        const logs = response?.log;
        if (!logs || !Array.isArray(logs) || logs.length === 0) {
          break;
        }

        await saveLogBatch(db, logs);

        if (logs.length < 100) {
          specialsHasMore = false;
        } else {
          const oldestInBatch = logs[logs.length - 1];
          currentSpecialsTo = Number(oldestInBatch.timestamp) - 1;
          if (currentSpecialsTo < startTimestamp) {
            specialsHasMore = false;
          }
        }

        specialsPages++;
        if (specialsHasMore && specialsPages < MAX_SPECIALS_PAGES) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (apiError) {
        logsLogger.error("[Backfill] Failed fetching historical stock specials page:", apiError);
        specialsHasMore = false;
      }
    }

    await db
      .insertInto("sentinel_processed_benefit_logs")
      .values({
        log_id: "backfill_specials_completed",
        processed_at: new Date().toISOString()
      })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .execute();

    logsLogger.success("[Backfill] Historical stock specials backfill completed.");
  }
}

async function saveLogBatch(db: any, logs: any[]): Promise<number> {
  let inserted = 0;
  const seenIds = new Map<string, number>();

  // Fetch current item prices
  const items = await db
    .selectFrom(TABLE_NAMES.TORN_ITEMS)
    .select(["item_id", "value"])
    .execute()
    .catch(() => []);
  
  const itemPriceMap = new Map<number, number>();
  for (const item of items) {
    itemPriceMap.set(Number(item.item_id), Number(item.value || 0));
  }

  for (const log of logs) {
    const rawId = String(log.id);
    const count = seenIds.get(rawId) || 0;
    seenIds.set(rawId, count + 1);

    const logId = count === 0 ? rawId : `${rawId}_${count}`;
    const timestamp = Number(log.timestamp);
    const category = String(log.details?.category || log.category || "");
    const title = String(log.details?.title || log.title || "");
    const data = log.data || {};

    const catLower = category.toLowerCase();
    const titleLower = title.toLowerCase();
    const logIdNum = Number(log.details?.id || log.log || 0);
    const isRehab = logIdNum === 6005 || titleLower === "rehab";
    const isBounty = logIdNum === 6700 || logIdNum === 6710 || catLower === "bounties" || catLower === "bounty";
    const isStockSpecialLog = (logIdNum >= 5530 && logIdNum <= 5537) || catLower === "134" || catLower.includes("stock");
    
    if (!FINANCE_LOG_CATEGORIES.has(catLower) && !catLower.includes("item use") && !isRehab && !isBounty && !isStockSpecialLog) {
      continue;
    }

    // For item use logs, inject the historical price
    const isItemUse = catLower.includes("item use") || catLower === "drugs" || catLower === "drug";
    if (isItemUse) {
      const itemId = Number(data.item || data.item_id || data.id || 0);
      if (itemId && itemPriceMap.has(itemId)) {
        data.historical_item_value = itemPriceMap.get(itemId);
      }
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

    inserted++;
  }
  return inserted;
}

export async function syncUserInventory(db: any, client: any, apiKey: string): Promise<void> {
  const categories = [
    "Melee", "Defensive", "Temporary", "Medical", "Booster", "Drug",
    "Energy Drink", "Alcohol", "Candy", "Special", "Supply Pack",
    "Primary", "Secondary", "Enhancer", "Artifact", "Collectible",
    "Clothing", "Material", "Car", "Flower", "Jewelry", "Plushie",
    "Book", "Tool", "Other"
  ];
  try {
    const apiResults = await Promise.all(
      categories.map((cat) =>
        client.get("/user/inventory" as any, {
          apiKey,
          queryParams: { cat },
        }).catch((e: any) => {
          portfolioLogger.error(`[Inventory Sync] Failed to fetch category ${cat}:`, e);
          return null;
        })
      )
    );

    const currentItems: Array<{ id: number; amount: number }> = [];
    for (const res of apiResults) {
      if (res?.inventory?.items) {
        for (const item of res.inventory.items) {
          if (item.id) {
            currentItems.push({
              id: Number(item.id),
              amount: Number(item.amount || 1),
            });
          }
        }
      }
    }

    if (currentItems.length > 0) {
      for (const item of currentItems) {
        await db
          .insertInto("sentinel_user_assets" as any)
          .values({
            asset_type: "item",
            asset_key: String(item.id),
            quantity: item.amount,
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.columns(["asset_type", "asset_key"]).doUpdateSet({
              quantity: item.amount,
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }

      // Delete items no longer in inventory
      const currentIds = currentItems.map((item) => String(item.id));
      await db
        .deleteFrom("sentinel_user_assets" as any)
        .where("asset_type", "=", "item")
        .where("asset_key", "not in", currentIds)
        .execute();
    } else {
      const successCount = apiResults.filter((r) => r !== null).length;
      if (successCount === categories.length) {
        await db
          .deleteFrom("sentinel_user_assets" as any)
          .where("asset_type", "=", "item")
          .execute();
      }
    }
  } catch (err) {
    portfolioLogger.error("[Inventory Sync] Error syncing inventory:", err);
  }
}

/**
 * Updates daily finance snapshots inflow/outflow/net profit from logs.
 */
async function updateDailySnapshot(db: any): Promise<void> {
  try {
    const nowTime = new Date();
    const dateStr = nowTime.toISOString().split("T")[0]; // YYYY-MM-DD in UTC (TCT)
    const startOfTodayTCT = Math.floor(Date.UTC(nowTime.getUTCFullYear(), nowTime.getUTCMonth(), nowTime.getUTCDate()) / 1000);

    // 1. Read today's logs from DB
    const dbLogs = await db
      .selectFrom("sentinel_financial_logs" as any)
      .selectAll()
      .where("timestamp", ">=", startOfTodayTCT)
      .execute()
      .catch(() => []);

    // 2. Fetch point price and items for parsing
    const marketPrices = await db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []);
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key ?? "", Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;

    const items = await db.selectFrom("sentinel_torn_items").select(["item_id", "name", "value"]).execute().catch(() => []);
    const itemMap = new Map<number, { name: string; value: number }>();
    const itemNameMap = new Map<string, { item_id: number; name: string; value: number }>();
    for (const item of items) {
      const info = { name: item.name, value: Number(item.value || 0) };
      itemMap.set(Number(item.item_id), info);
      itemNameMap.set(item.name.toLowerCase(), { item_id: Number(item.item_id), ...info });
    }

    const { parseFinanceLedger } = await import("@sentinel/shared");
    const { income, expenses } = parseFinanceLedger(
      dbLogs as any[],
      itemMap,
      itemNameMap,
      pointPrice
    );

    // 3. Load latest daily snapshot row to check company locking status
    const existingSnap = await db
      .selectFrom("sentinel_daily_finance_snapshots")
      .selectAll()
      .where("date", "=", dateStr)
      .executeTakeFirst();

    let compIncome = 0;
    let compWages = 0;
    let compAds = 0;
    let compLocked = 0;

    if (existingSnap) {
      compIncome = Number(existingSnap.company_income || 0);
      compWages = Number(existingSnap.company_wages || 0);
      compAds = Number(existingSnap.company_ad_budget || 0);
      compLocked = Number(existingSnap.company_profit_locked || 0);
    }

    // 4. Inflow and Outflow totals combined with company profit if locked
    const inflowTotal = income.total + compIncome;
    const outflowTotal = expenses.total + compWages + compAds;
    const netProfit = inflowTotal - outflowTotal;

    // 5. Load latest valuations from portfolio cache as fallback if not populated
    let cachedNetworth = existingSnap?.estimated_networth || 0;
    let cachedLiquid = existingSnap?.liquid_capital || 0;
    let cachedAssets = existingSnap?.asset_valuation || 0;

    if (!cachedNetworth || !cachedLiquid || !cachedAssets) {
      const latestPortfolio = await db
        .selectFrom("sentinel_portfolio_snapshot")
        .selectAll()
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      if (latestPortfolio) {
        const portData = JSON.parse(latestPortfolio.data);
        cachedNetworth = cachedNetworth || portData?.total_value || 0;
        cachedLiquid = cachedLiquid || portData?.liquid?.total_value || 0;
        cachedAssets = cachedAssets || (portData?.total_value - portData?.liquid?.total_value || 0);
      }
    }

    // 6. Upsert the daily snapshot
    await db
      .insertInto("sentinel_daily_finance_snapshots" as any)
      .values({
        date: dateStr,
        estimated_networth: cachedNetworth,
        liquid_capital: cachedLiquid,
        asset_valuation: cachedAssets,
        net_profit: netProfit,
        inflow: inflowTotal,
        outflow: outflowTotal,
        company_income: compIncome,
        company_wages: compWages,
        company_ad_budget: compAds,
        company_profit_locked: compLocked,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc: any) =>
        oc.column("date").doUpdateSet({
          net_profit: netProfit,
          inflow: inflowTotal,
          outflow: outflowTotal,
          updated_at: new Date().toISOString(),
        })
      )
      .execute();

    logsLogger.success(`[Snapshot] Daily snapshot P&L updated for ${dateStr}. Inflow: ${inflowTotal.toLocaleString()}, Outflow: ${outflowTotal.toLocaleString()}`);

  } catch (error) {
    logsLogger.error("[Snapshot] Error updating daily finance snapshot:", error);
  }
}

/**
 * Main handler for logs sync worker.
 */
export async function syncFinanceLogs(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    logsLogger.error("No personal API key found, skipping finance logs sync.");
    return;
  }
  const db = getKysely();

  // 1. Dynamically backfill stock logs if not done
  await backfillStockLogs(db, apiKey);

  // 2. Fetch the latest timestamp in logs
  const latestLog = await db
    .selectFrom("sentinel_financial_logs" as any)
    .select("timestamp")
    .orderBy("timestamp", "desc")
    .limit(1)
    .executeTakeFirst();

  const now = new Date();
  const startOfTodayTCT = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);

  let fromTimestamp = startOfTodayTCT;
  if (latestLog) {
    fromTimestamp = Math.max(startOfTodayTCT, Number(latestLog.timestamp));
  }
  const toTimestamp = Math.floor(Date.now() / 1000);

  logsLogger.info(`Starting finance logs forward sync from timestamp ${fromTimestamp} to ${toTimestamp}...`);

  let countNewLogs = 0;
  let forwardHasMore = true;
  let currentForwardTo = toTimestamp;
  let forwardPages = 0;
  const MAX_FORWARD_PAGES = 10;

  while (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
    try {
      const response = (await tornApi.get("/user/log" as any, {
        apiKey,
        queryParams: {
          from: String(fromTimestamp),
          to: String(currentForwardTo),
          limit: "100",
        },
      })) as any;

      const logs = response.log;
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        forwardHasMore = false;
        break;
      }

      const inserted = await saveLogBatch(db, logs);
      countNewLogs += inserted;

      if (logs.length < 100) {
        forwardHasMore = false;
      } else {
        const oldestInBatch = logs[logs.length - 1];
        currentForwardTo = Number(oldestInBatch.timestamp) - 1;
        if (currentForwardTo < fromTimestamp) {
          forwardHasMore = false;
        }
      }

      forwardPages++;
      if (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (apiError) {
      logsLogger.error("Failed syncing logs page from Torn API", apiError);
      forwardHasMore = false;
    }
  }

  if (countNewLogs > 0) {
    logsLogger.success(`Successfully synced ${countNewLogs} new financial log entries.`);
  }

  // 3. Process payouts
  await processStockBenefitPayouts(db);

  // 4. Update snapshot P&L
  await updateDailySnapshot(db);
}

/**
 * Main handler for portfolio sync worker.
 */
export async function syncPortfolioSnapshot(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    portfolioLogger.error("No personal API key found, skipping portfolio sync.");
    return;
  }
  const db = getKysely();

  try {
    portfolioLogger.info("Starting portfolio sync: fetching API endpoints...");

    // 1. Sync inventory items first into database cache
    await syncUserInventory(db, tornApi, apiKey);

    // 2. Fetch required endpoints
    const [moneyResponse, userResponse, companyResponse, userStocksResponse, tornStocksResponse, propertiesResponse] = (await Promise.all([
      tornApi.get("/user/money" as any, { apiKey }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch money:", e);
        return null;
      }),
      tornApi.get("/user" as any, {
        apiKey,
        queryParams: { selections: ["networth", "bazaar", "display", "itemmarket", "profile"] }
      }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch user profile/items:", e);
        return null;
      }),
      tornApi.get("/company/profile" as any, { apiKey }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch company profile:", e);
        return null;
      }),
      tornApi.get("/user/stocks" as any, { apiKey }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch user stocks:", e);
        return null;
      }),
      tornApi.get("/torn/stocks" as any, { apiKey }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch torn stocks:", e);
        return null;
      }),
      tornApi.get("/user/properties" as any, {
        apiKey,
        queryParams: { filters: "ownedByUser" }
      }).catch((e) => {
        portfolioLogger.error("[Portfolio] Failed to fetch properties:", e);
        return null;
      })
    ])) as any[];

    // 3. Populate sentinel_torn_stocks table with latest prices
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        await db
          .insertInto("sentinel_torn_stocks" as any)
          .values({
            stock_id: Number(stock.id),
            name: String(stock.name || ""),
            acronym: String(stock.acronym || ""),
            logo_image: stock.logo_image || null,
            price: Number(stock.market?.price || 0),
            market_cap: Number(stock.market?.market_cap || 0),
            shares: Number(stock.market?.shares || 0),
            investors: Number(stock.market?.investors || 0),
            bonus_passive: stock.bonus?.passive ? 1 : 0,
            bonus_frequency: Number(stock.bonus?.frequency || 0),
            bonus_requirement: Number(stock.bonus?.requirement || 0),
            bonus_description: String(stock.bonus?.description || ""),
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.column("stock_id").doUpdateSet({
              name: String(stock.name || ""),
              acronym: String(stock.acronym || ""),
              price: Number(stock.market?.price || 0),
              market_cap: Number(stock.market?.market_cap || 0),
              shares: Number(stock.market?.shares || 0),
              investors: Number(stock.market?.investors || 0),
              bonus_passive: stock.bonus?.passive ? 1 : 0,
              bonus_frequency: Number(stock.bonus?.frequency || 0),
              bonus_requirement: Number(stock.bonus?.requirement || 0),
              bonus_description: String(stock.bonus?.description || ""),
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }
    }

    const networthTotal = userResponse?.networth?.total || moneyResponse?.money?.daily_networth || 0;
    const wallet = moneyResponse?.money?.wallet || 0;
    const vault = moneyResponse?.money?.vault || 0;
    const pointsQuantity = moneyResponse?.money?.points || 0;

    // Load point price from db or fallback
    const marketPrices = await db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []);
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key ?? "", Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;
    const pointsValue = pointsQuantity * pointPrice;

    // Company calculations
    let companyFunds = 0;
    let companyAdBudget = 0;
    let companyWages = 0;
    let companyDailyIncome = 0;
    let companyDailyProfit = 0;
    let companyName = "No Company";

    const companyId = companyResponse ? Number(companyResponse.profile?.id || companyResponse.profile?.company_id || 0) : 0;
    const isDirector = companyResponse?.profile?.director?.id === userResponse?.profile?.id || companyResponse?.profile?.director?.id === 1934909;

    if (companyId > 0 && companyResponse) {
      companyName = companyResponse.profile.name || "Company";
      companyFunds = companyResponse.profile.funds || 0;
      companyAdBudget = Number(companyResponse.profile.advertisement_budget || 0);
      companyDailyIncome = Number(companyResponse.profile.income?.daily || 0);

      if (isDirector) {
        const companyEmployeesResponse = (await tornApi.get("/company/employees" as any, { apiKey }).catch((e) => {
          portfolioLogger.error("[Portfolio] Failed to fetch company employees:", e);
          return null;
        })) as any;

        const empList = Array.isArray(companyEmployeesResponse)
          ? companyEmployeesResponse
          : (companyEmployeesResponse?.employees || []);

        for (const emp of empList) {
          companyWages += Number((emp as any).wage || 0);
        }
      }
      companyDailyProfit = companyDailyIncome - companyWages - companyAdBudget;
    }

    const companyWithdrawable = Math.max(0, companyFunds - (companyWages * 7) - (companyAdBudget * 7));
    const liquidCapital = wallet + vault + pointsValue + companyWithdrawable;

    // 1. Properties
    let propertiesTotalValue = 0;
    const propertiesList: any[] = [];
    if (propertiesResponse?.properties) {
      for (const prop of propertiesResponse.properties) {
        const val = prop.market_price || prop.value || (Number(prop.property) === 13 ? 475000000 : 0);
        propertiesTotalValue += val;
        propertiesList.push({
          id: String(prop.id),
          name: String(prop.name || "Property"),
          value: val,
          happy: Number(prop.happy || 0),
          status: String(prop.status || "Owned")
        });
      }
    }

    // 2. Inventory (including Display Case, Bazaar, Item Market)
    const dbInventory = await db
      .selectFrom("sentinel_user_assets" as any)
      .selectAll()
      .where("asset_type", "=", "item")
      .execute()
      .catch(() => []);

    const tornItems = await db.selectFrom("sentinel_torn_items").select(["item_id", "name", "value", "image", "type"]).execute().catch(() => []);
    const itemMap = new Map<number, { name: string; value: number; image: string; type: string }>();
    for (const item of tornItems) {
      itemMap.set(Number(item.item_id), {
        name: item.name,
        value: Number(item.value || 0),
        image: item.image || "",
        type: item.type || ""
      });
    }

    let inventoryTotalValue = 0;
    const inventoryList: any[] = [];

    // Local regular inventory
    for (const row of dbInventory) {
      const itemId = Number(row.asset_key);
      const qty = Number(row.quantity || 0);
      if (!itemId || qty <= 0) continue;
      const itemInfo = itemMap.get(itemId);
      const itemVal = itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryTotalValue += totalVal;
      inventoryList.push({
        item_id: itemId,
        name: itemInfo?.name || "Unknown Item",
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || "Other",
        location: "Inventory"
      });
    }

    // Bazaar items
    const bazaarItems = userResponse?.bazaar || [];
    for (const item of bazaarItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryTotalValue += totalVal;
      inventoryList.push({
        item_id: itemId,
        name: item.name || itemInfo?.name || "Bazaar Item",
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || "Other",
        location: "Bazaar"
      });
    }

    // Display Case items
    const displayItems = userResponse?.display || [];
    for (const item of displayItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryTotalValue += totalVal;
      inventoryList.push({
        item_id: itemId,
        name: item.name || itemInfo?.name || "Display Case Item",
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || "Other",
        location: "Display Case"
      });
    }

    // Item Market items
    const itemMarketItems = userResponse?.itemmarket || [];
    for (const item of itemMarketItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryTotalValue += totalVal;
      inventoryList.push({
        item_id: itemId,
        name: item.name || itemInfo?.name || "Market Item",
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || "Other",
        location: "Item Market"
      });
    }

    // 3. Stocks Value & Holdings & Benefits
    let stocksTotalValue = 0;
    const holdings: any[] = [];
    const benefits: any[] = [];

    const heldStocksMap = new Map<number, number>();
    if (userStocksResponse?.stocks) {
      for (const stock of userStocksResponse.stocks) {
        heldStocksMap.set(Number(stock.id), Number(stock.shares || 0));
      }
    }

    const tornStocksMap = new Map<number, { name: string; acronym: string; price: number }>();
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        tornStocksMap.set(Number(stock.id), {
          name: stock.name,
          acronym: stock.acronym,
          price: stock.market?.price || 0,
        });
      }
    }

    // Calculate total stock value and holdings list
    if (userStocksResponse?.stocks) {
      for (const holding of userStocksResponse.stocks) {
        const stockId = Number(holding.id);
        const shares = Number(holding.shares || 0);
        const priceInfo = tornStocksMap.get(stockId);
        if (priceInfo && shares > 0) {
          const totalVal = shares * priceInfo.price;
          stocksTotalValue += totalVal;

          const transactionsList = holding.transactions || [];
          let totalCost = 0;
          let totalSharesForCost = 0;
          for (const tx of transactionsList) {
            const txShares = Number(tx.shares || 0);
            const txPrice = Number(tx.price || 0);
            totalCost += txShares * txPrice;
            totalSharesForCost += txShares;
          }
          const avgBuyPrice = totalSharesForCost > 0 ? (totalCost / totalSharesForCost) : priceInfo.price;
          const boughtValue = avgBuyPrice * shares;
          const profitLoss = totalVal - boughtValue;
          const profitLossPct = boughtValue > 0 ? (profitLoss / boughtValue) * 100 : 0;

          holdings.push({
            id: stockId,
            name: priceInfo.name,
            acronym: priceInfo.acronym,
            shares,
            price: priceInfo.price,
            total_value: totalVal,
            avg_buy_price: avgBuyPrice,
            profit_loss: profitLoss,
            profit_loss_pct: profitLossPct,
          });
        }
      }
      holdings.sort((a, b) => b.total_value - a.total_value);
    }

    // Stock Benefits
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        if (!stock.bonus || !stock.bonus.requirement || stock.bonus.requirement <= 0) {
          continue;
        }

        const stockId = Number(stock.id);
        const acronym = stock.acronym;
        const name = stock.name;
        const currentPrice = stock.market?.price || 0;
        const requirement = Number(stock.bonus.requirement);
        const frequencyDays = Number(stock.bonus.frequency || 0);
        const isPassive = !!stock.bonus.passive;
        const benefitDesc = stock.bonus.description || "";

        const heldShares = heldStocksMap.get(stockId) || 0;

        let active_increments = 0;
        if (heldShares >= requirement) {
          if (isPassive) {
            active_increments = 1;
          } else {
            active_increments = Math.floor(Math.log2(heldShares / requirement + 1));
            if (acronym === "MCS") {
              active_increments = Math.min(10, active_increments);
            }
          }
        }

        let progressPct = 0;
        let sharesNeeded = 0;
        let costToComplete = 0;
        let next_required_total_shares = requirement;

        const isMaxMCS = acronym === "MCS" && active_increments >= 10;
        const isMaxPassive = isPassive && active_increments >= 1;

        if (isMaxMCS || isMaxPassive) {
          progressPct = 100;
          sharesNeeded = 0;
          costToComplete = 0;
          next_required_total_shares = requirement * (isPassive ? 1 : (Math.pow(2, active_increments) - 1));
        } else {
          next_required_total_shares = requirement * (Math.pow(2, active_increments + 1) - 1);
          const next_increment_cost = requirement * Math.pow(2, active_increments);
          const current_tier_total = requirement * (Math.pow(2, active_increments) - 1);
          const held_towards_next = heldShares - current_tier_total;
          
          progressPct = Math.min(100, Math.max(0, (held_towards_next / next_increment_cost) * 100));
          sharesNeeded = Math.max(0, next_required_total_shares - heldShares);
          costToComplete = sharesNeeded * currentPrice;
        }

        // Estimate Payout Value dynamically
        let payoutValue = 0;
        const descLower = benefitDesc.toLowerCase();

        if (benefitDesc.startsWith("$")) {
          payoutValue = Number(benefitDesc.replace(/[^0-9]/g, "")) || 0;
        } else if (descLower.includes("points")) {
          const ptsMatch = benefitDesc.match(/\d+/);
          const ptsCount = ptsMatch ? Number(ptsMatch[0]) : 0;
          payoutValue = ptsCount * pointPrice;
        } else if (descLower.includes("energy")) {
          if (descLower.includes("six-pack")) {
            payoutValue = priceMap.get("six-pack of energy drink") || 12000000;
          } else {
            payoutValue = 0;
          }
        } else if (descLower.includes("nerve")) {
          payoutValue = 0;
        } else if (descLower.includes("happy") || descLower.includes("happiness")) {
          payoutValue = 0;
        } else if (descLower.includes("lawyer's business card")) {
          payoutValue = priceMap.get("lawyer's business card") || 500000;
        } else if (descLower.includes("medical supplies")) {
          payoutValue = priceMap.get("box of medical supplies") || 270000;
        } else if (descLower.includes("feathery hotel coupon")) {
          payoutValue = priceMap.get("feathery hotel coupon") || 13500000;
        } else if (descLower.includes("drug pack")) {
          payoutValue = priceMap.get("drug pack") || 4200000;
        } else if (descLower.includes("lottery voucher")) {
          payoutValue = priceMap.get("lottery voucher") || priceMap.get("lottery ticket") || 1000000;
        } else if (descLower.includes("erotic dvd")) {
          payoutValue = priceMap.get("erotic dvd") || 2800000;
        } else if (descLower.includes("grenades")) {
          payoutValue = priceMap.get("box of grenades") || 1000000;
        } else if (descLower.includes("property")) {
          payoutValue = 5000000;
        } else if (descLower.includes("ammunition pack")) {
          payoutValue = priceMap.get("ammunition pack") || 3600000;
        } else if (descLower.includes("clothing cache")) {
          payoutValue = priceMap.get("clothing cache") || 1800000;
        } else if (descLower.includes("alcohol")) {
          payoutValue = priceMap.get("six-pack of alcohol") || 30000;
        } else if (isPassive) {
          payoutValue = 0;
        }

        const baseAnnualPayout = (frequencyDays > 0 && !isPassive) ? (payoutValue * 365) / frequencyDays : 0;
        let currentAnnualPayout = 0;
        let currentApr = 0;
        if (active_increments >= 1) {
          currentAnnualPayout = active_increments * baseAnnualPayout;
          currentApr = (heldShares > 0) ? (currentAnnualPayout / (heldShares * currentPrice)) * 100 : 0;
        }

        let nextIncrementApr = 0;
        if (!isMaxMCS && !isMaxPassive) {
          const nextIncrementCost = requirement * Math.pow(2, active_increments);
          nextIncrementApr = (nextIncrementCost > 0) ? (baseAnnualPayout / (nextIncrementCost * currentPrice)) * 100 : 0;
        }

        // Format payout description frequency
        let formattedFreq = isPassive ? "Passive" : `every ${frequencyDays}d`;
        if (frequencyDays === 7) formattedFreq = "Weekly";
        else if (frequencyDays === 30 || frequencyDays === 31) formattedFreq = "Monthly";

        benefits.push({
          stock_id: stockId,
          acronym,
          name,
          active_increments,
          required_shares: requirement,
          held_shares: heldShares,
          current_price: currentPrice,
          progress_pct: progressPct,
          shares_needed: sharesNeeded,
          cost_to_complete: costToComplete,
          next_required_total_shares,
          payout_desc: benefitDesc + (isPassive ? " (Passive)" : ` (${formattedFreq})`),
          frequency_days: frequencyDays,
          payout_value: payoutValue,
          annual_payout_value: currentAnnualPayout || baseAnnualPayout,
          apr: currentApr || nextIncrementApr,
          next_increment_apr: nextIncrementApr,
          is_active: active_increments >= 1,
        });
      }
      benefits.sort((a, b) => b.apr - a.apr);
    }

    const companyTotalVal = userResponse?.networth?.company ?? companyFunds;
    const totalAssetsValue = networthTotal;
    const assetValuation = Math.max(0, networthTotal - liquidCapital);

    const snapshotPayload = {
      city_bank: {
        amount: Number(moneyResponse?.money?.city_bank?.amount || 0),
        profit: Number(moneyResponse?.money?.city_bank?.profit || 0),
        principal: Number(moneyResponse?.money?.city_bank?.amount || 0) - Number(moneyResponse?.money?.city_bank?.profit || 0),
        timeleft: Number(moneyResponse?.money?.city_bank?.until || 0) > 0 ? Math.max(0, Number(moneyResponse?.money?.city_bank?.until || 0) - Math.floor(Date.now() / 1000)) : 0,
        progress_pct: 0,
        cayman_bank: Number(moneyResponse?.money?.cayman_bank || 0)
      },
      stocks: {
        total_value: stocksTotalValue,
        holdings,
        benefits,
      },
      properties: {
        properties: propertiesList,
        total_value: propertiesTotalValue
      },
      company: {
        name: companyName,
        funds: companyFunds,
        total_value: companyTotalVal,
        daily_income: companyDailyIncome,
        daily_ad_budget: companyAdBudget,
        daily_wages: companyWages,
        daily_profit: companyDailyProfit
      },
      inventory: {
        items: inventoryList,
        total_value: inventoryTotalValue
      },
      liquid: {
        wallet,
        vault,
        points: pointsQuantity,
        points_value: pointsValue,
        company_withdrawable: companyWithdrawable,
        total_value: liquidCapital
      },
      total_value: totalAssetsValue
    };

    // Calculate Bank lock maturity progress
    if (snapshotPayload.city_bank.amount > 0 && moneyResponse?.money?.city_bank?.invested_at && moneyResponse?.money?.city_bank?.until) {
      const start = Number(moneyResponse.money.city_bank.invested_at);
      const end = Number(moneyResponse.money.city_bank.until);
      const totalTime = end - start;
      const elapsed = Math.floor(Date.now() / 1000) - start;
      snapshotPayload.city_bank.progress_pct = totalTime > 0 ? Math.min(100, Math.max(0, (elapsed / totalTime) * 100)) : 0;
    }

    // 4. Save to sentinel_portfolio_snapshot
    await db
      .insertInto("sentinel_portfolio_snapshot" as any)
      .values({
        data: JSON.stringify(snapshotPayload),
        created_at: new Date().toISOString(),
      })
      .execute();

    // Cleanup old snapshots
    const allSnaps = await db
      .selectFrom("sentinel_portfolio_snapshot" as any)
      .select("id")
      .orderBy("id", "desc")
      .execute();
      
    if (allSnaps.length > 5) {
      const idsToDelete = allSnaps.slice(5).map((r: any) => r.id);
      await db
        .deleteFrom("sentinel_portfolio_snapshot" as any)
        .where("id", "in", idsToDelete)
        .execute();
    }

    // 5. Update valuations in sentinel_daily_finance_snapshots for today
    const dateStr = new Date().toISOString().split("T")[0];
    const existingSnap = await db
      .selectFrom("sentinel_daily_finance_snapshots")
      .selectAll()
      .where("date", "=", dateStr)
      .executeTakeFirst();

    let compIncome = 0;
    let compWages = 0;
    let compAds = 0;
    let compLocked = 0;

    if (existingSnap) {
      compIncome = Number(existingSnap.company_income || 0);
      compWages = Number(existingSnap.company_wages || 0);
      compAds = Number(existingSnap.company_ad_budget || 0);
      compLocked = Number(existingSnap.company_profit_locked || 0);
    }

    // Handle company profit locking logic after 18:03 TCT
    const nowTime = new Date();
    const tctHour = nowTime.getUTCHours();
    const tctMinute = nowTime.getUTCMinutes();
    const isAfterCompanyNewDay = tctHour > 18 || (tctHour === 18 && tctMinute >= 3);

    if (!compLocked && isAfterCompanyNewDay && isDirector && companyId > 0) {
      compIncome = companyDailyIncome;
      compWages = companyWages;
      compAds = companyAdBudget;
      compLocked = 1;
      portfolioLogger.info(`[Portfolio] Locking company profit for today at ${tctHour}:${tctMinute} TCT: Income: ${compIncome}, Wages: ${compWages}, Ads: ${compAds}`);
    }

    // Re-query database logs for today to sum correct inflow/outflow
    const startOfTodayTCT = Math.floor(Date.UTC(nowTime.getUTCFullYear(), nowTime.getUTCMonth(), nowTime.getUTCDate()) / 1000);
    const dbLogs = await db
      .selectFrom("sentinel_financial_logs" as any)
      .selectAll()
      .where("timestamp", ">=", startOfTodayTCT)
      .execute()
      .catch(() => []);

    const { parseFinanceLedger } = await import("@sentinel/shared");
    const { income, expenses } = parseFinanceLedger(
      dbLogs as any[],
      itemMap,
      new Map(),
      pointPrice
    );

    const inflowTotal = income.total + compIncome;
    const outflowTotal = expenses.total + compWages + compAds;
    const netProfit = inflowTotal - outflowTotal;

    await db
      .insertInto("sentinel_daily_finance_snapshots" as any)
      .values({
        date: dateStr,
        estimated_networth: networthTotal,
        liquid_capital: liquidCapital,
        asset_valuation: assetValuation,
        net_profit: netProfit,
        inflow: inflowTotal,
        outflow: outflowTotal,
        company_income: compIncome,
        company_wages: compWages,
        company_ad_budget: compAds,
        company_profit_locked: compLocked,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc: any) =>
        oc.column("date").doUpdateSet({
          estimated_networth: networthTotal,
          liquid_capital: liquidCapital,
          asset_valuation: assetValuation,
          net_profit: netProfit,
          inflow: inflowTotal,
          outflow: outflowTotal,
          company_income: compIncome,
          company_wages: compWages,
          company_ad_budget: compAds,
          company_profit_locked: compLocked,
          updated_at: new Date().toISOString(),
        })
      )
      .execute();

    portfolioLogger.success(`[Portfolio] Cache updated successfully. Networth: ${networthTotal.toLocaleString()}`);

  } catch (err) {
    portfolioLogger.error("[Portfolio] Error updating portfolio cache:", err);
  }
}

export function startTornFinanceLogsWorker(): void {
  startDbScheduledRunner({
    worker: LOGS_WORKER_NAME,
    defaultCadenceSeconds: 900,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: LOGS_WORKER_NAME,
        timeout: 120000,
        handler: syncFinanceLogs,
      });
    },
  });
}

export function startTornPortfolioWorker(): void {
  startDbScheduledRunner({
    worker: PORTFOLIO_WORKER_NAME,
    defaultCadenceSeconds: 3600,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: PORTFOLIO_WORKER_NAME,
        timeout: 180000,
        handler: syncPortfolioSnapshot,
      });
    },
  });
}
