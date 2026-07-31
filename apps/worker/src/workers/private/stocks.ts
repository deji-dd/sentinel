import { Logger } from "@sentinel/utils";
import { db, Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { tornApiManager, getPersonalKey } from "@sentinel/torn-api-manager";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "stocks_module";
const logger = new Logger(WORKER_NAME);

export const STOCK_ACTIVITY_LOG_IDS = [5510, 5511, 5520, 5521];
export const STOCK_GAIN_LOG_IDS = [
  5530, 5531, 5532, 5533, 5534, 5535, 5536, 5537,
];

type UserLog = TornSchema<"UserLog">;

let isSyncingUserStocks = false;
let pendingSync = false;

/**
 * Debounced activity trigger to sync active user stock positions.
 */
export async function parseStockActivityLog(): Promise<void> {
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

/**
 * Fetches user stocks from `/user/stocks` API and updates `db.userStock`.
 */
export async function syncUserStocks(): Promise<void> {
  const keyEntry = await getPersonalKey();
  if (!keyEntry) return;

  try {
    const res = await tornApiManager.get("/user/stocks", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
    });

    if (res.stocks) {
      const stocksArray = res.stocks;

      for (const stock of stocksArray) {
        await db.userStock.upsert({
          where: { id: String(stock.id) },
          update: {
            shares: stock.shares,
            transactions: (stock.transactions as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            bonus: (stock.bonus as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            updatedAt: new Date(),
          },
          create: {
            id: String(stock.id),
            shares: stock.shares,
            transactions: (stock.transactions as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            bonus: (stock.bonus as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      logger.info(
        `Synced ${stocksArray.length} active UserStocks from Torn API.`,
      );
    }
  } catch (err) {
    logger.error("Failed to sync user stocks data:", err);
  }
}

/**
 * Parses individual stock gain log into `StockLedger` and `LedgerEvent`.
 */
export async function parseStockGainLog(log: UserLog): Promise<boolean> {
  const data = (log.data as Record<string, any>) || {};
  if (!data || !data.stock) return false;

  const stockId = Number(data.stock);
  const userStock = await db.userStock.findUnique({
    where: { id: String(stockId) },
  });
  if (!userStock) return false;

  const tornStock = await db.tornStock.findUnique({
    where: { id: String(stockId) },
  });
  const stockBonus = (tornStock?.bonus as Record<string, any>) ?? {};
  if (stockBonus.passive) return false;

  const reqShares = Number(stockBonus.requirement || 0);
  if (userStock.shares < reqShares) return false;

  const txs = (userStock.transactions as Array<{ timestamp?: number }>) || [];
  let oldestTx = Number.MAX_SAFE_INTEGER;
  for (const tx of txs) {
    if (tx.timestamp && tx.timestamp < oldestTx) oldestTx = tx.timestamp;
  }

  if (log.timestamp < oldestTx) return false;

  let valueReceived = 0;
  let itemId: number | undefined = undefined;

  if (data.money) {
    valueReceived = Number(data.money);
  } else if (data.item) {
    const itemIds = Object.keys(data.item);
    if (itemIds.length > 0) {
      itemId = Number(itemIds[0]);
      const qty = Number(data.item[itemIds[0]]);

      const itemRecord = await db.tornItem.findUnique({
        where: { id: String(itemId) },
      });
      const itemData = (itemRecord?.data as Record<string, any>) ?? {};
      valueReceived = qty * (itemData.value?.market_price || 0);
    }
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  // 1. Record in StockLedger
  await db.stockLedger.upsert({
    where: { id: logIdStr },
    update: {
      timestamp: logTimestamp,
      stockId,
      logType: Number(log.details.id),
      value: valueReceived,
      itemId,
    },
    create: {
      id: logIdStr,
      timestamp: logTimestamp,
      stockId,
      logType: Number(log.details.id),
      value: valueReceived,
      itemId,
      createdAt: new Date(),
    },
  });

  // 2. Record in LedgerEvent
  await db.ledgerEvent.upsert({
    where: { id: `ledger_ev_${logIdStr}` },
    update: {
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "stock_dividend",
      categoryId: 8,
      transactionName: "Stock Benefit Block Dividend",
      assetsAffected: itemId
        ? [
            {
              assetId: String(itemId),
              quantityChange: 1,
              costBasisImpact: valueReceived,
            },
          ]
        : [],
      cashFlow: data.money ? valueReceived : 0,
      realizedPnl: valueReceived,
      rawLog: log as unknown as object,
      updatedAt: new Date(),
    },
    create: {
      id: `ledger_ev_${logIdStr}`,
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "stock_dividend",
      categoryId: 8,
      transactionName: "Stock Benefit Block Dividend",
      assetsAffected: itemId
        ? [
            {
              assetId: String(itemId),
              quantityChange: 1,
              costBasisImpact: valueReceived,
            },
          ]
        : [],
      cashFlow: data.money ? valueReceived : 0,
      realizedPnl: valueReceived,
      rawLog: log as unknown as object,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return true;
}

/**
 * Initializes Stock Ledger:
 * 1. Checks if historical log backfill is completed.
 * 2. Replays stock gain logs from PostgreSQL `PersonalLog`.
 */
async function runStockLedgerInit(): Promise<void> {
  try {
    logger.info("Initializing Stock Ledger...");

    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed") {
      logger.warn(
        "Log backfill is ongoing. Postponing Stock Ledger initialization.",
      );
      return;
    }

    await syncUserStocks();

    const userStocks = await db.userStock.findMany();
    if (userStocks.length === 0) {
      logger.warn(
        "User has no active stock holdings. Marking stock ledger init complete.",
      );
      await db.systemState.upsert({
        where: { id: "stock_ledger_init" },
        update: {
          init: true,
          data: { status: "completed" },
          updatedAt: new Date(),
        },
        create: {
          id: "stock_ledger_init",
          init: true,
          data: { status: "completed" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return;
    }

    const stockLogs = await db.personalLog.findMany({
      where: { log: { in: STOCK_GAIN_LOG_IDS } },
      orderBy: { timestamp: "asc" },
    });

    logger.info(`Replaying ${stockLogs.length} historical stock gain logs...`);

    let parsed = 0;
    for (const pLog of stockLogs) {
      await parseStockGainLog({
        id: pLog.id as any,
        timestamp: Math.floor(pLog.timestamp.getTime() / 1000),
        data: pLog.data as any,
        details: {
          id: pLog.log,
          title: pLog.title || "",
          category: pLog.category || "",
        },
        params: {} as any,
      });
      parsed++;
    }

    await db.systemState.upsert({
      where: { id: "stock_ledger_init" },
      update: {
        init: true,
        data: { status: "completed" },
        updatedAt: new Date(),
      },
      create: {
        id: "stock_ledger_init",
        init: true,
        data: { status: "completed" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(
      `Stock Ledger initialized successfully. Parsed ${parsed} logs.`,
    );
  } catch (err) {
    logger.error("Failed to initialize Stock Ledger:", err);
  }
}

/**
 * Checks and starts stock initialization if required.
 */
async function checkAndInitStocks(): Promise<void> {
  const initState = await db.systemState.findUnique({
    where: { id: "stock_ledger_init" },
  });

  if (!initState || !initState.init) {
    await runStockLedgerInit();
  }
}

/**
 * Registers real-time log event listeners for stock logs.
 */
export function startStocksModule(_options?: WorkerStartOptions): void {
  checkAndInitStocks().catch((err) =>
    logger.error("Error during stocks checkAndInit:", err),
  );

  workerEvents.on("new_log", async (log: UserLog) => {
    const logCode = Number(log.details.id);
    if (STOCK_ACTIVITY_LOG_IDS.includes(logCode)) {
      await parseStockActivityLog();
    } else if (STOCK_GAIN_LOG_IDS.includes(logCode)) {
      await parseStockGainLog(log);
    }
  });

  workerEvents.on("log_backfill_completed", () => {
    checkAndInitStocks().catch((err) =>
      logger.error("Error running Stocks init after backfill:", err),
    );
  });
}
