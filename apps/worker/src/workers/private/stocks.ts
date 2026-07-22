import {
  Logger,
  SystemState,
  tornApi,
  getWorkerApiKey,
  UserStocks,
  StockLedger,
  type SystemStateDocument,
  TornItems,
  TornStocks,
  StrictUserLog,
  LogRouteMap,
  PersonalLogs,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";

const logger = new Logger("stocks_module");

// We keep these exported because runBackgroundStockLogBackfill uses them to build API requests
export const STOCK_ACTIVITY_LOG_IDS = [5510, 5511, 5520, 5521];
export const STOCK_GAIN_LOG_IDS = [
  5530, 5531, 5532, 5533, 5534, 5535, 5536, 5537,
];

// Create strictly typed ID unions for the function signatures
type StockGainIds = 5530 | 5531 | 5532 | 5533 | 5534 | 5535 | 5536 | 5537;

let isSyncingUserStocks = false;
let pendingSync = false;

export async function parseStockActivityLog() {
  if (isSyncingUserStocks) {
    pendingSync = true;
    return;
  }

  isSyncingUserStocks = true;
  try {
    do {
      pendingSync = false;
      await syncUserStocks();
    } while (pendingSync);
  } finally {
    isSyncingUserStocks = false;
  }
}

async function syncUserStocks() {
  const apiKey = getWorkerApiKey("personal");
  if (!apiKey) return;

  try {
    const res = await tornApi.get("/user/stocks", { apiKey });
    if (res.stocks) {
      UserStocks.deleteManyBy({});
      const userStocksToInsert = [];
      const stocksArray = res.stocks;
      for (const stock of stocksArray) {
        userStocksToInsert.push({
          id: String(stock.id),
          shares: stock.shares || 0,
          transactions: stock.transactions,
          bonus: stock.bonus,
        });
      }
      if (userStocksToInsert.length > 0) {
        UserStocks.insertMany(userStocksToInsert);
      }
      logger.info("Silently synced UserStocks from activity log");
    }
  } catch (e) {
    logger.error("Failed to sync user stocks data:", e);
  }
}

export function parseStockGainLog(log: StrictUserLog<StockGainIds>) {
  // Notice we deleted the legacy ID inclusion check here as well
  const data = log.data; // Perfectly typed as StockGainPayload
  if (!data || !data.stock) return;

  const stockId = Number(data.stock);
  const userStock = UserStocks.findOne(String(stockId));
  if (!userStock) return;

  const tStock = TornStocks.findOne(String(stockId));
  if (!tStock || !tStock.bonus || tStock.bonus.passive) return;

  const hasEnoughShares = userStock.shares >= tStock.bonus.requirement;
  if (!hasEnoughShares) return;

  let oldestTx = Number.MAX_SAFE_INTEGER;
  for (const tx of userStock.transactions || []) {
    if (tx.timestamp < oldestTx) oldestTx = tx.timestamp;
  }

  if (log.timestamp < oldestTx) return;

  let valueReceived = 0;
  let itemId: number | undefined = undefined;

  if (data.money) {
    valueReceived = Number(data.money);
  } else if (data.item) {
    const itemIds = Object.keys(data.item);
    if (itemIds.length > 0) {
      itemId = Number(itemIds[0]);
      const qty = Number(data.item[itemIds[0]]);

      const item = TornItems.findOne(String(itemId));

      if (item) {
        // @ts-ignore
        valueReceived = qty * (item.data.value?.market_price || 0);
      }
    }
  }

  StockLedger.insertOne({
    id: String(log.id),
    timestamp: log.timestamp,
    stock_id: stockId,
    log_type: log.details.id,
    value: valueReceived,
    item_id: itemId,
  });
}

async function runStockLedgerInit() {
  try {
    logger.warn("Initializing Stock Ledger V2.");

    // 1. Wipe broken/legacy data
    StockLedger.deleteManyBy({});

    // 2. Fetch current stocks to establish the "bought time" baselines
    await syncUserStocks();

    const userStocks = UserStocks.findAll();
    if (userStocks.length === 0) {
      logger.warn("User has no stocks. Skipping log parse.");
      SystemState.update({
        id: "stock_ledger_v2_init",
        init: true,
        timestamp: Math.floor(Date.now() / 1000),
      });
      return;
    }

    // 3. Find the absolute oldest transaction timestamp across all active BBs
    let globalOldestTimestamp = Date.now() / 1000;
    let activeBBFound = false;

    for (const stock of userStocks) {
      const tStock = TornStocks.findOne(String(stock.id));
      if (!tStock || !tStock.bonus || tStock.bonus.passive) continue;

      const hasEnoughShares = stock.shares >= tStock.bonus.requirement;
      if (!hasEnoughShares) continue;

      activeBBFound = true;

      for (const tx of stock.transactions || []) {
        if (tx.timestamp < globalOldestTimestamp) {
          globalOldestTimestamp = tx.timestamp;
        }
      }
    }

    if (!activeBBFound) {
      logger.warn("User has no active non-passive BBs. Skipping log parse.");
      SystemState.update({
        id: "stock_ledger_v2_init",
        init: true,
        timestamp: Math.floor(Date.now() / 1000),
      });
      return;
    }

    // 4. Query the local DB and filter by gain IDs and the global oldest timestamp
    const allLogs = PersonalLogs.findAll();
    const stockLogs = allLogs
      .filter(
        (log) =>
          STOCK_GAIN_LOG_IDS.includes(log.details.id) &&
          log.timestamp >= globalOldestTimestamp,
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    logger.info(
      `Found ${stockLogs.length} historical stock gain logs. Replaying...`,
    );

    // 5. Replay through the strict parser (which dynamically checks exact bought times)
    let parsed = 0;
    for (const log of stockLogs) {
      // @ts-ignore - Safely crossing the strict type boundary during bulk dispatch
      parseStockGainLog(log);
      parsed++;
    }

    // 6. Save the new V2 state
    SystemState.update({
      id: "stock_ledger_v2_init",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    logger.info(
      `Stock Ledger initialized successfully. Parsed ${parsed} logs.`,
    );
  } catch (error) {
    logger.error("Failed to initialize Stock Ledger:", error);
  }
}

function checkAndInit() {
  const backfillState = SystemState.findOne("log_manager_backfill_progress") as
    | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
    | undefined;

  if (!backfillState || backfillState.status !== "completed") {
    logger.warn(
      "Log backfill is ongoing or incomplete. Postponing Stocks module initialization.",
    );
    return;
  }

  const initState = SystemState.findOne("stock_ledger_v2_init");
  if (!initState) {
    runStockLedgerInit();
  }
}

export function startStocksModule(): void {
  checkAndInit();

  workerEvents.on("log_backfill_completed", () => {
    checkAndInit();
  });
}

// Keep the route map exactly as it is
export const STOCK_LOG_ROUTES: LogRouteMap = {
  // Activity
  5510: [parseStockActivityLog],
  5511: [parseStockActivityLog],
  5520: [parseStockActivityLog],
  5521: [parseStockActivityLog],

  // Gains
  5530: [parseStockGainLog],
  5531: [parseStockGainLog],
  5532: [parseStockGainLog],
  5533: [parseStockGainLog],
  5534: [parseStockGainLog],
  5535: [parseStockGainLog],
  5536: [parseStockGainLog],
  5537: [parseStockGainLog],
};
