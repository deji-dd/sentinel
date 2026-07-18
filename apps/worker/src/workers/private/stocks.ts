import {
  Logger,
  SystemState,
  tornApi,
  getWorkerApiKey,
  UserStocks,
  StockLedger,
  type TornSchema,
  UserConfig,
  ApiKeyRotator,
  type SystemStateDocument,
  TornItems,
  TornStocks,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";

const logger = new Logger("stocks_worker");

export const STOCK_GAIN_LOG_IDS = [
  5530, 5531, 5532, 5533, 5534, 5535, 5536, 5537,
];

export const STOCK_ACTIVITY_LOG_IDS = [
  5510, 5511, 5520, 5521,
];

let isSyncingUserStocks = false;
let pendingSync = false;

export async function parseStockActivityLog(log: TornSchema<"UserLog">) {
  if (!STOCK_ACTIVITY_LOG_IDS.includes(log.details.id)) return;
  
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

export function parseStockGainLog(log: TornSchema<"UserLog">) {
  if (!STOCK_GAIN_LOG_IDS.includes(log.details.id)) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
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

      const allItems = TornItems.findAll();
      const item = allItems.find((i) => String(i.id) === String(itemId));

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

export async function runStockLedgerInit() {
  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const existingProgress = SystemState.findOne(
      "stock_ledger_backfill_progress",
    ) as
      | Extract<SystemStateDocument, { id: "stock_ledger_backfill_progress" }>
      | undefined;

    const isResuming =
      existingProgress && existingProgress.status === "in_progress";

    if (!isResuming) {
      StockLedger.deleteManyBy({});
      await syncUserStocks();

      SystemState.update({
        id: "stock_ledger_backfill_progress",
        timestamp: Math.floor(Date.now() / 1000),
        status: "in_progress",
        logs_parsed: 0,
        oldest_timestamp_reached: null,
        active_chunks: null,
      });
    }

    runBackgroundStockLogBackfill(
      apiKey,
      isResuming ? existingProgress : undefined,
    ).catch((e) => {
      logger.error("Background stock backfill failed", e);
      SystemState.update({
        id: "stock_ledger_backfill_progress",
        timestamp: Math.floor(Date.now() / 1000),
        status: "error",
        error: e.message,
      });
    });

    finishSync();
  } catch (error) {
    logger.error("Failed to initialize Stock Ledger:", error);
  }
}

async function runBackgroundStockLogBackfill(
  apiKey: string,
  resumeData?: Extract<
    SystemStateDocument,
    { id: "stock_ledger_backfill_progress" }
  >,
) {
  if (resumeData) {
    logger.info(
      `Resuming stock backfill. Already parsed: ${resumeData.logs_parsed}`,
    );
  } else {
    logger.info("Starting background historical backfill for Stock Ledger");
  }

  const userStocks = UserStocks.findAll();
  if (userStocks.length === 0) {
    logger.info("User has no stocks. Skipping log backfill.");
    SystemState.update({
      id: "stock_ledger_init_state",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });
    SystemState.update({
      id: "stock_ledger_backfill_progress",
      timestamp: Math.floor(Date.now() / 1000),
      status: "completed",
      logs_parsed: 0,
      oldest_timestamp_reached: null,
      active_chunks: [],
    });
    return;
  }

  // Find oldest transaction timestamp among active, non-passive BBs
  let globalOldestTimestamp = Date.now() / 1000;
  let activeBBFound = false;

  for (const stock of userStocks) {
    const tStock = TornStocks.findOne(String(stock.id));
    if (!tStock || !tStock.bonus || tStock.bonus.passive) continue;

    // @ts-ignore
    const hasEnoughShares = stock.shares >= tStock.bonus.requirement;
    if (!hasEnoughShares) continue;

    activeBBFound = true;
    // @ts-ignore
    for (const tx of stock.transactions) {
      if (tx.timestamp < globalOldestTimestamp) {
        globalOldestTimestamp = tx.timestamp;
      }
    }
  }

  if (!activeBBFound) {
    logger.info("User has no active non-passive BBs. Skipping log backfill.");
    SystemState.update({
      id: "stock_ledger_init_state",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });
    SystemState.update({
      id: "stock_ledger_backfill_progress",
      timestamp: Math.floor(Date.now() / 1000),
      status: "completed",
      logs_parsed: 0,
      oldest_timestamp_reached: null,
      active_chunks: [],
    });
    return;
  }

  let totalParsed = resumeData?.logs_parsed || 0;
  let overallOldestTimestamp: number | undefined =
    resumeData?.oldest_timestamp_reached ?? undefined;

  let activeChunks: { logSelection: string; currentTo: number | undefined }[] =
    [];
  if (resumeData?.active_chunks) {
    activeChunks = resumeData.active_chunks;
  } else {
    activeChunks.push({
      logSelection: STOCK_GAIN_LOG_IDS.join(","),
      currentTo: undefined,
    });
  }

  const rotator = new ApiKeyRotator([apiKey]);

  while (activeChunks.length > 0) {
    const nextChunks: typeof activeChunks = [];

    await rotator.processSequential(
      activeChunks,
      async (chunk, key) => {
        try {
          const queryParams: Record<string, string | number> = {
            selections: "log",
            log: chunk.logSelection,
          };
          if (chunk.currentTo) queryParams.to = chunk.currentTo;

          const res = await tornApi.get<{
            log?: Record<string, TornSchema<"UserLog">>;
          }>("/user", { apiKey: key, queryParams });

          if (!res.log || Object.keys(res.log).length === 0) return;

          const logs = Object.values(res.log);
          if (logs.length === 0) return;

          let oldestInBatch = Date.now() / 1000;
          let reachedGlobalOldest = false;

          for (const log of logs) {
            if (log.timestamp < globalOldestTimestamp) {
              reachedGlobalOldest = true;
              break;
            }
            parseStockGainLog(log);
            totalParsed++;
            if (log.timestamp < oldestInBatch) {
              oldestInBatch = log.timestamp;
            }
          }

          if (
            !overallOldestTimestamp ||
            oldestInBatch < overallOldestTimestamp
          ) {
            overallOldestTimestamp = oldestInBatch;
          }

          if (!reachedGlobalOldest && oldestInBatch > globalOldestTimestamp) {
            nextChunks.push({
              logSelection: chunk.logSelection,
              currentTo: oldestInBatch,
            });
          }
        } catch (error) {
          logger.error(
            `Error during stock backfill at to=${chunk.currentTo}`,
            error,
          );
          throw error;
        }
      },
      1000,
    );

    activeChunks = nextChunks;

    SystemState.update({
      id: "stock_ledger_backfill_progress",
      timestamp: Math.floor(Date.now() / 1000),
      status: "in_progress",
      logs_parsed: totalParsed,
      oldest_timestamp_reached: overallOldestTimestamp,
      active_chunks: activeChunks,
    });

    logger.info(
      `Stock Backfill progress: Parsed ${totalParsed} logs, reached ${overallOldestTimestamp}`,
    );
  }

  SystemState.update({
    id: "stock_ledger_backfill_progress",
    timestamp: Math.floor(Date.now() / 1000),
    status: "completed",
    logs_parsed: totalParsed,
    oldest_timestamp_reached: overallOldestTimestamp,
    active_chunks: [],
  });

  SystemState.update({
    id: "stock_ledger_init_state",
    init: true,
    timestamp: Math.floor(Date.now() / 1000),
  });

  logger.info(`Completed stock backfill. Parsed ${totalParsed} logs.`);
}

export function startStocksModule(): void {
  checkSettingsAndInit();

  workerEvents.on("settings_updated", () => {
    checkSettingsAndInit();
  });
}

function checkSettingsAndInit() {
  const config = UserConfig.findOne("global");
  // @ts-ignore
  if (config?.stocks_module_enabled) {
    const initState = SystemState.findOne("stock_ledger_init_state") as
      | { init: boolean }
      | undefined;
    if (!initState || !initState.init) {
      runStockLedgerInit().catch((e) => logger.error("Stock Init Failed", e));
    }
  } else {
    // User requested toggling should clear relative tables
    StockLedger.deleteManyBy({});
    UserStocks.deleteManyBy({});
    SystemState.delete("stock_ledger_init_state");
    SystemState.delete("stock_ledger_backfill_progress");
  }
}
