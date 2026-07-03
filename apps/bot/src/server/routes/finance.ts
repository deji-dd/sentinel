/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Request, type Response } from "express";
import { TABLE_NAMES, parseFinanceLedger } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { getServerContext } from "../context.js";

export const financeRouter = Router();


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

// Helper to decrypt personal API key
async function getPersonalApiKey(): Promise<string | undefined> {
  let apiKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
  try {
    const keyRow = await db
      .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
      .select("api_key_encrypted")
      .where("key_type", "=", "personal")
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    
    if (keyRow?.api_key_encrypted && process.env.ENCRYPTION_KEY) {
      const { decryptApiKey } = await import("@sentinel/shared");
      apiKey = decryptApiKey(keyRow.api_key_encrypted, process.env.ENCRYPTION_KEY);
    }
  } catch (err) {
    console.error("[HTTP] Failed to fetch/decrypt personal API key:", err);
  }
  return apiKey;
}

// Sync helper for User Inventory Category
async function syncUserInventory(db: any, client: any, apiKey: string): Promise<void> {
  const categories = [
    "Melee",
    "Defensive",
    "Temporary",
    "Medical",
    "Booster",
    "Drug",
    "Energy Drink",
    "Alcohol",
    "Candy",
    "Special",
    "Supply Pack",
    "Primary",
    "Secondary",
    "Enhancer",
    "Artifact",
    "Collectible",
    "Clothing",
    "Material",
    "Car",
    "Flower",
    "Jewelry",
    "Plushie",
    "Book",
    "Tool",
    "Other"
  ];
  try {
    const apiResults = await Promise.all(
      categories.map((cat) =>
        client.get("/user/inventory" as any, {
          apiKey,
          queryParams: { cat },
        }).catch((e: any) => {
          console.error(`[Inventory Sync] Failed to fetch category ${cat}:`, e);
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
    console.error("[Inventory Sync] Error syncing inventory:", err);
  }
}

financeRouter.get("/ledger", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "SENTINEL_USER_ID is not configured on server" });
    }

    const apiKey = await getPersonalApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Personal API key not found or misconfigured" });
    }

    // 1. Fetch item prices and points valuation
    const items = await db
      .selectFrom(TABLE_NAMES.TORN_ITEMS)
      .select(["item_id", "name", "value", "image", "type"])
      .execute();

    const itemMap = new Map<number, { name: string; value: number; image: string; type: string }>();
    const itemNameMap = new Map<string, { item_id: number; name: string; value: number; image: string; type: string }>();
    for (const item of items) {
      const itemId = Number(item.item_id);
      if (itemId) {
        itemMap.set(itemId, {
          name: item.name || "",
          value: item.value ?? 0,
          image: item.image || "",
          type: item.type || "",
        });
      }
      if (item.name) {
        itemNameMap.set(item.name.toLowerCase(), {
          item_id: itemId,
          name: item.name,
          value: item.value ?? 0,
          image: item.image || "",
          type: item.type || "",
        });
      }
    }

    const marketPrices = await db
      .selectFrom(TABLE_NAMES.MARKET_PRICES)
      .select(["key", "value"])
      .execute();

    const priceMap = new Map<string, number>();
    for (const row of marketPrices) {
      priceMap.set(row.key, Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;

    const nowTime = new Date();
    const startOfTodayTCT = Math.floor(Date.UTC(nowTime.getUTCFullYear(), nowTime.getUTCMonth(), nowTime.getUTCDate()) / 1000);

    // 2. Fetch logged transactions from DB
    const dbLogs = await db
      .selectFrom("sentinel_financial_logs" as any)
      .selectAll()
      .where("timestamp", ">=", startOfTodayTCT)
      .orderBy("timestamp", "desc")
      .execute();

    // 3. Fetch current user selections and company profile from v2 API
    const { TornApiClient } = await import("@sentinel/shared");
    const client = new TornApiClient();

    const [
      moneyResponse,
      userResponse,
      propertiesResponse,
      companyResponse,
      userStocksResponse,
      tornStocksResponse
    ] = await Promise.all([
      client.get("/user/money" as any, {
        apiKey,
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch user money for ledger:", e);
        return null;
      }),
      client.get("/user" as any, {
        apiKey,
        queryParams: {
          selections: ["networth", "bazaar", "display", "itemmarket"]
        }
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch user networth & items for ledger:", e);
        return null;
      }),
      client.get("/user/properties" as any, {
        apiKey,
        queryParams: {
          filters: "ownedByUser",
        },
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch user properties for ledger:", e);
        return null;
      }),
      client.get("/company/profile" as any, {
        apiKey,
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch company profile for ledger:", e);
        return null;
      }),
      client.get("/user/stocks" as any, {
        apiKey,
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch user stocks for ledger:", e);
        return null;
      }),
      client.get("/torn/stocks" as any, {
        apiKey,
      }).catch((e) => {
        console.error("[HTTP] Failed to fetch torn stocks prices for ledger:", e);
        return null;
      }),
    ]);

    let companyEmployeesResponse = null;
    const companyId = Number(companyResponse?.profile?.id || 0);
    if (companyId > 0) {
      companyEmployeesResponse = await client.get("/company/employees" as any, {
        apiKey,
      }).catch((e: any) => {
        console.error("[HTTP] Failed to fetch company employees for ledger:", e);
        return null;
      });
    }

    // 4. Parse P&L Ledger transactions using shared parser
    const { income, expenses, transactions } = parseFinanceLedger(
      dbLogs as any[],
      itemMap,
      itemNameMap,
      pointPrice
    );

    // 5. Parse Asset Ledger details
    const wallet = moneyResponse?.money?.wallet || 0;
    const pointsQuantity = moneyResponse?.money?.points || 0;
    const pointsValue = pointsQuantity * pointPrice;
    const vault = moneyResponse?.money?.vault || 0;

    // Load inventory from DB cached assets
    const dbInventory = await db
      .selectFrom("sentinel_user_assets" as any)
      .selectAll()
      .where("asset_type", "=", "item")
      .execute();

    const inventoryList: any[] = [];
    let inventoryTotalValue = 0;
    for (const row of dbInventory) {
      const itemId = Number(row.asset_key);
      const qty = Number(row.quantity || 0);
      if (!itemId || qty <= 0) continue;

      let itemVal = 0;
      let image = "";
      let type = "";

      if (itemMap.has(itemId)) {
        const itemInfo = itemMap.get(itemId)!;
        itemVal = itemInfo.value;
        image = itemInfo.image || "";
        type = itemInfo.type || "";
      }

      const totalVal = itemVal * qty;
      inventoryList.push({
        item_id: itemId,
        name: itemMap.get(itemId)?.name || `Item #${itemId}`,
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image,
        type,
        location: "Inventory",
      });
      inventoryTotalValue += totalVal;
    }

    // Include items from bazaar
    const bazaarItems = userResponse?.bazaar || [];
    for (const item of bazaarItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      if (!itemId || qty <= 0) continue;
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryList.push({
        item_id: itemId,
        name: itemInfo?.name || item.name || `Item #${itemId}`,
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || item.type || "",
        location: "Bazaar",
      });
      inventoryTotalValue += totalVal;
    }

    // Include items from display case
    const displayItems = userResponse?.display || [];
    for (const item of displayItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      if (!itemId || qty <= 0) continue;
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryList.push({
        item_id: itemId,
        name: itemInfo?.name || item.name || `Item #${itemId}`,
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || item.type || "",
        location: "Display Case",
      });
      inventoryTotalValue += totalVal;
    }

    // Include items from item market
    const itemMarketItems = userResponse?.itemmarket || [];
    for (const item of itemMarketItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      if (!itemId || qty <= 0) continue;
      const itemInfo = itemMap.get(itemId);
      const itemVal = item.market_price || itemInfo?.value || 0;
      const totalVal = itemVal * qty;
      inventoryList.push({
        item_id: itemId,
        name: itemInfo?.name || item.name || `Item #${itemId}`,
        quantity: qty,
        value: itemVal,
        total_value: totalVal,
        image: itemInfo?.image || "",
        type: itemInfo?.type || item.type || "",
        location: "Item Market",
      });
      inventoryTotalValue += totalVal;
    }

    const propertiesList: any[] = [];
    let propertiesTotalValue = 0;
    if (propertiesResponse?.properties) {
      for (const prop of propertiesResponse.properties) {
        const name = prop.property_name || prop.name || `Property #${prop.property || prop.id}`;
        const val = prop.market_price || prop.value || (Number(prop.property) === 13 ? 475000000 : 0);
        propertiesList.push({
          id: String(prop.id || prop.property || ""),
          name,
          value: val,
          happy: prop.happy || 0,
          status: prop.status || "",
        });
        propertiesTotalValue += val;
      }
    }

    // Company assets
    let companyFunds = 0;
    let companyName = "No Company";
    let companyDailyIncome = 0;
    let companyAdBudget = 0;
    let companyWages = 0;

    if (companyResponse?.profile) {
      companyFunds = companyResponse.profile.funds || 0;
      companyName = companyResponse.profile.name || "Your Company";
      companyDailyIncome = companyResponse.profile.income?.daily || 0;
      companyAdBudget = (companyResponse.profile as any).advertisement_budget || 0;
    }

    const empList = Array.isArray(companyEmployeesResponse)
      ? companyEmployeesResponse
      : (companyEmployeesResponse?.employees || []);

    for (const emp of empList) {
      companyWages += Number((emp as any).wage || 0);
    }
    const companyDailyProfit = companyDailyIncome - companyAdBudget - companyWages;

    // Stocks assets
    let stocksTotalValue = 0;
    const stocksList: Array<{
      id: number;
      name: string;
      acronym: string;
      shares: number;
      price: number;
      total_value: number;
    }> = [];

    if (userStocksResponse?.stocks && tornStocksResponse?.stocks) {
      const priceMap = new Map<number, { name: string; acronym: string; price: number }>();
      for (const stock of tornStocksResponse.stocks) {
        priceMap.set(Number(stock.id), {
          name: stock.name,
          acronym: stock.acronym,
          price: stock.market?.price || 0,
        });
      }

      for (const holding of userStocksResponse.stocks) {
        const stockId = Number(holding.id);
        const shares = Number(holding.shares);
        const priceInfo = priceMap.get(stockId);
        if (priceInfo && shares > 0) {
          const totalVal = shares * priceInfo.price;
          stocksTotalValue += totalVal;
          stocksList.push({
            id: stockId,
            name: priceInfo.name,
            acronym: priceInfo.acronym,
            shares,
            price: priceInfo.price,
            total_value: totalVal,
          });
        }
      }

      stocksList.sort((a, b) => b.total_value - a.total_value);
    }

    // Company income is strictly based on the logged payouts for that day, no daily profit projection override.

    const companyWithdrawable = Math.max(0, companyFunds - (companyWages * 7) - (companyAdBudget * 7));
    const liquidValue = wallet + vault + pointsValue + companyWithdrawable;
    const totalAssetsValue = userResponse?.networth?.total ?? (liquidValue + inventoryTotalValue + propertiesTotalValue + (userResponse?.networth?.company ?? companyFunds) + stocksTotalValue);

    const scheduleRow = await db
      .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .innerJoin(TABLE_NAMES.WORKERS, `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`, `${TABLE_NAMES.WORKERS}.id`)
      .select([
        `${TABLE_NAMES.WORKER_SCHEDULES}.last_run_at as last_run_at`,
        `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`
      ])
      .where(`${TABLE_NAMES.WORKERS}.name`, "=", "torn_finance_logs_worker")
      .executeTakeFirst();

    res.json({
      pl: {
        income,
        expenses,
        net_profit: income.total - expenses.total,
        transactions: transactions.slice(0, 150),
      },
      assets: {
        liquid: {
          wallet,
          vault,
          points: pointsQuantity,
          points_value: pointsValue,
          company_withdrawable: companyWithdrawable,
          total_value: liquidValue,
        },
        inventory: {
          items: inventoryList,
          total_value: inventoryTotalValue,
        },
        properties: {
          properties: propertiesList,
          total_value: propertiesTotalValue,
        },
        company: {
          name: companyName,
          funds: companyFunds,
          total_value: userResponse?.networth?.company ?? companyFunds,
          daily_income: companyDailyIncome,
          daily_ad_budget: companyAdBudget,
          daily_wages: companyWages,
          daily_profit: companyDailyProfit,
        },
        stocks: {
          items: stocksList,
          total_value: stocksTotalValue,
        },
        total_value: totalAssetsValue,
      },
      syncStatus: {
        lastSyncAt: scheduleRow?.last_run_at || null,
        nextRunAt: scheduleRow?.next_run_at || null,
        totalLogs: dbLogs.length,
        minTimestamp: dbLogs.length > 0 ? Number(dbLogs[dbLogs.length - 1].timestamp) : null,
        maxTimestamp: dbLogs.length > 0 ? Number(dbLogs[0].timestamp) : null,
      }
    });

  } catch (error) {
    console.error("[HTTP] Error fetching financial ledger:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.get("/portfolio", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    // Fetch the latest snapshot from DB
    const latestSnapshot = await db
      .selectFrom("sentinel_portfolio_snapshot" as any)
      .selectAll()
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!latestSnapshot) {
      return res.status(404).json({ error: "No portfolio snapshot cached yet. Please wait for worker sync." });
    }

    const payload = JSON.parse(latestSnapshot.data);
    res.json(payload);
  } catch (error) {
    console.error("[HTTP] Error fetching portfolio data:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.get("/daily-snapshots", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const snapshots = await db
      .selectFrom("sentinel_daily_finance_snapshots" as any)
      .selectAll()
      .orderBy("date", "asc")
      .limit(30)
      .execute();

    res.json(snapshots);
  } catch (error) {
    console.error("[HTTP] Error fetching daily snapshots:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.post("/sync-ledger", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const apiKey = await getPersonalApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Personal API key not configured on server" });
    }

    const { TornApiClient } = await import("@sentinel/shared");
    const client = new TornApiClient();

    // 1. Sync User Inventory synchronously into DB
    console.log("[HTTP] Triggering manual live inventory sync...");
    await syncUserInventory(db, client, apiKey);

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

    // 2. Fetch today's logs page-by-page (descending pagination) from TCT midnight to now
    console.log("[HTTP] Triggering manual live log fetch for /sync-ledger...");
    const nowTime = Math.floor(Date.now() / 1000);
    const nowDateObj = new Date();
    const startOfTodayTCT = Math.floor(Date.UTC(nowDateObj.getUTCFullYear(), nowDateObj.getUTCMonth(), nowDateObj.getUTCDate()) / 1000);

    let currentForwardTo = nowTime;
    let forwardHasMore = true;
    let forwardPages = 0;
    const MAX_FORWARD_PAGES = 5; // Max 5 pages for synchronous manual sync
    let _inserted = 0;

    while (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
      const response = await client.get("/user/log" as any, {
        apiKey,
        queryParams: {
          from: String(startOfTodayTCT),
          to: String(currentForwardTo),
          limit: "100",
        },
      }).catch((e) => {
        console.error(`[HTTP] Manual sync page ${forwardPages + 1} fetch failed:`, e);
        return null;
      });

      const logs = response?.log;
      if (!logs || !Array.isArray(logs) || logs.length === 0) {
        break;
      }

      console.log(`[HTTP] Manual sync page ${forwardPages + 1} returned ${logs.length} logs.`);
      const seenIds = new Map<string, number>();
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

        if (!FINANCE_LOG_CATEGORIES.has(catLower) && !catLower.includes("item use") && !isRehab && !isBounty) {
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

        _inserted++;
      }

      if (logs.length < 100) {
        forwardHasMore = false;
      } else {
        const oldestInBatch = logs[logs.length - 1];
        currentForwardTo = Number(oldestInBatch.timestamp) - 1;
        if (currentForwardTo < startOfTodayTCT) {
          forwardHasMore = false;
        }
      }

      forwardPages++;
      if (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const workerRow = await db
      .selectFrom(TABLE_NAMES.WORKERS)
      .select("id")
      .where("name", "=", "torn_finance_logs_worker")
      .limit(1)
      .executeTakeFirst();

    if (workerRow) {
      await db
        .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
        .set({ force_run: 1 })
        .where("worker_id", "=", workerRow.id)
        .execute();
      console.log(`[HTTP] Set force_run = 1 in database for torn_finance_logs_worker.`);
    }

    // Update daily snapshots and portfolio cache immediately
    await syncDailySnapshot(db, client, apiKey);
    await syncPortfolioSnapshot(db, client, apiKey);

    res.json({
      success: true,
      message: `Manual sync complete. Synced inventory, logs, and updated snapshots.`,
    });

  } catch (error) {
    console.error("[HTTP] Error forcing finance log sync:", error);
    res.status(500).json({ error: "Server error" });
  }
});

async function syncDailySnapshot(db: any, client: any, apiKey: string): Promise<void> {
  try {
    const [moneyResponse, userResponse, companyResponse, userStocksResponse, tornStocksResponse] = (await Promise.all([
      client.get("/user/money" as any, { apiKey }).catch((e: any) => {
        console.error("[Snapshot] Failed to fetch money:", e);
        return null;
      }),
      client.get("/user" as any, {
        apiKey,
        queryParams: { selections: ["networth", "bazaar", "display", "itemmarket"] }
      }).catch((e: any) => {
        console.error("[Snapshot] Failed to fetch user networth/items:", e);
        return null;
      }),
      client.get("/company/profile" as any, { apiKey }).catch((e: any) => {
        console.error("[Snapshot] Failed to fetch company profile:", e);
        return null;
      }),
      client.get("/user/stocks" as any, { apiKey }).catch((e: any) => {
        console.error("[Snapshot] Failed to fetch user stocks:", e);
        return null;
      }),
      client.get("/torn/stocks" as any, { apiKey }).catch((e: any) => {
        console.error("[Snapshot] Failed to fetch torn stocks:", e);
        return null;
      })
    ])) as any[];

    const networthTotal = userResponse?.networth?.total || moneyResponse?.money?.daily_networth || 0;
    const wallet = moneyResponse?.money?.wallet || 0;
    const vault = moneyResponse?.money?.vault || 0;
    const pointsQuantity = moneyResponse?.money?.points || 0;

    const marketPrices = await db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []);
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key, Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;
    const pointsValue = pointsQuantity * pointPrice;

    let companyFunds = 0;
    let companyAdBudget = 0;
    let companyWages = 0;

    const companyId = companyResponse ? Number(companyResponse.profile?.id || 0) : 0;
    if (companyId > 0 && companyResponse) {
      companyFunds = companyResponse.profile.funds || 0;
      companyAdBudget = Number((companyResponse.profile as any).advertisement_budget || 0);

      // Verify the user is the director before calling company/employees
      const isDirector = companyResponse.profile.director?.id === userResponse?.profile?.id || 
                         companyResponse.profile.director?.id === 1934909;

      if (isDirector) {
        const companyEmployeesResponse = (await client.get("/company/employees" as any, { apiKey }).catch((e: any) => {
          console.error("[Snapshot] Failed to fetch company employees:", e);
          return null;
        })) as any;

        const empList = Array.isArray(companyEmployeesResponse)
          ? companyEmployeesResponse
          : (companyEmployeesResponse?.employees || []);

        for (const emp of empList) {
          companyWages += Number((emp as any).wage || 0);
        }
      }
    }

    const companyWithdrawable = Math.max(0, companyFunds - (companyWages * 7) - (companyAdBudget * 7));
    const liquidCapital = wallet + vault + pointsValue + companyWithdrawable;

    const propertiesResponse = (await client.get("/user/properties" as any, {
      apiKey,
      queryParams: { filters: "ownedByUser" }
    }).catch((e: any) => {
      console.error("[Snapshot] Failed to fetch properties:", e);
      return null;
    })) as any;

    let propertiesTotalValue = 0;
    if (propertiesResponse?.properties) {
      for (const prop of propertiesResponse.properties) {
        const val = prop.market_price || prop.value || (Number(prop.property) === 13 ? 475000000 : 0);
        propertiesTotalValue += val;
      }
    }

    const dbInventory = await db
      .selectFrom("sentinel_user_assets" as any)
      .selectAll()
      .where("asset_type", "=", "item")
      .execute()
      .catch(() => []);

    const tornItems = await db
      .selectFrom("sentinel_torn_items" as any)
      .select(["item_id", "value"])
      .execute()
      .catch(() => []);

    const itemPriceLookup = new Map<number, number>();
    for (const item of tornItems || []) {
      itemPriceLookup.set(Number(item.item_id), Number(item.value || 0));
    }

    let inventoryTotalValue = 0;
    for (const asset of dbInventory || []) {
      const itemId = Number(asset.asset_key);
      const qty = Number(asset.quantity || 0);
      const val = itemPriceLookup.get(itemId) || 0;
      inventoryTotalValue += val * qty;
    }

    const displaycaseVal = Number(userResponse?.networth?.displaycase || 0);
    const bazaarVal = Number(userResponse?.networth?.bazaar || 0);
    const itemmarketVal = Number(userResponse?.networth?.itemmarket || 0);

    const heldStocksMap = new Map<number, number>();
    if (userStocksResponse?.stocks) {
      for (const stock of userStocksResponse.stocks) {
        heldStocksMap.set(Number(stock.id), Number(stock.shares || 0));
      }
    }

    const tornStocksMap = new Map<number, number>();
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        tornStocksMap.set(Number(stock.id), stock.market?.price || 0);
      }
    }

    let stocksTotalValue = 0;
    for (const [id, shares] of heldStocksMap.entries()) {
      const price = tornStocksMap.get(id) || 0;
      stocksTotalValue += price * shares;
    }

    const assetValuation = propertiesTotalValue + inventoryTotalValue + displaycaseVal + bazaarVal + itemmarketVal + stocksTotalValue;

    const dateStr = new Date().toISOString().split("T")[0];

    const now = new Date();
    const startOfTodayTCT = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);

    const dbLogs = await db
      .selectFrom("sentinel_financial_logs" as any)
      .selectAll()
      .where("timestamp", ">=", startOfTodayTCT)
      .execute()
      .catch(() => []);

    const itemMap = new Map<number, { name: string; value: number }>();
    const itemNameMap = new Map<string, { item_id: number; name: string; value: number }>();
    const allItems = await db.selectFrom("sentinel_torn_items" as any).selectAll().execute().catch(() => []);
    for (const item of allItems || []) {
      const val = Number(item.value || 0);
      const name = String(item.name || "");
      const itemId = Number(item.item_id);
      itemMap.set(itemId, { name, value: val });
      itemNameMap.set(name.toLowerCase(), { item_id: itemId, name, value: val });
    }

    const ledger = parseFinanceLedger(
      dbLogs as any[],
      itemMap,
      itemNameMap,
      pointPrice
    );

    const incomeTotal = ledger.income.total;
    const expensesTotal = ledger.expenses.total;
    const netProfit = incomeTotal - expensesTotal;

    await db
      .insertInto("sentinel_daily_finance_snapshots" as any)
      .values({
        date: dateStr,
        estimated_networth: networthTotal,
        liquid_capital: liquidCapital,
        asset_valuation: assetValuation,
        net_profit: netProfit,
        inflow: incomeTotal,
        outflow: expensesTotal,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc: any) =>
        oc.column("date").doUpdateSet({
          estimated_networth: networthTotal,
          liquid_capital: liquidCapital,
          asset_valuation: assetValuation,
          net_profit: netProfit,
          inflow: incomeTotal,
          outflow: expensesTotal,
          updated_at: new Date().toISOString(),
        })
      )
      .execute();

    console.log(`[Snapshot] Daily finance snapshot updated successfully for ${dateStr}.`);
  } catch (error) {
    console.error("[Snapshot] Error updating daily finance snapshot:", error);
  }
}

async function syncPortfolioSnapshot(db: any, client: any, apiKey: string): Promise<void> {
  try {
    const [moneyResponse, userStocksResponse, tornStocksResponse, marketPrices, dbItems] = (await Promise.all([
      client.get("/user/money" as any, { apiKey }).catch((e: any) => {
        console.error("[Portfolio] Failed to fetch money for snapshot:", e);
        return null;
      }),
      client.get("/user/stocks" as any, { apiKey }).catch((e: any) => {
        console.error("[Portfolio] Failed to fetch user stocks for snapshot:", e);
        return null;
      }),
      client.get("/torn/stocks" as any, { apiKey }).catch((e: any) => {
        console.error("[Portfolio] Failed to fetch torn stocks for snapshot:", e);
        return null;
      }),
      db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []),
      db.selectFrom("sentinel_torn_items" as any).select(["name", "value"]).execute().catch(() => [])
    ])) as any[];

    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key.toLowerCase(), Number(row.value));
    }
    for (const item of dbItems || []) {
      priceMap.set(item.name.toLowerCase(), Number(item.value || 0));
    }
    const pointPrice = priceMap.get("points") ?? 31000;

    const cityBankRaw = moneyResponse?.money?.city_bank || {};
    const bankAmount = Number(cityBankRaw.amount || 0);
    const bankProfit = Number(cityBankRaw.profit || 0);
    const bankPrincipal = bankAmount - bankProfit;
    const bankInvestedAt = Number(cityBankRaw.invested_at || 0);
    const bankUntil = Number(cityBankRaw.until || 0);
    
    const nowSeconds = Math.floor(Date.now() / 1000);
    const bankTimeleft = bankUntil > 0 ? Math.max(0, bankUntil - nowSeconds) : 0;
    const initialDurationSeconds = (bankUntil > 0 && bankInvestedAt > 0) ? (bankUntil - bankInvestedAt) : 0;
    const bankElapsed = (bankUntil > 0 && bankInvestedAt > 0) ? Math.max(0, nowSeconds - bankInvestedAt) : 0;
    const bankProgressPct = (bankAmount > 0 && initialDurationSeconds > 0)
      ? Math.min(100, (bankElapsed / initialDurationSeconds) * 100)
      : 0;
    const caymanBank = Number(moneyResponse?.money?.cayman_bank || 0);

    const heldStocksMap = new Map<number, number>();
    const holdings = [];
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

    let stocksTotalValue = 0;
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

    const benefits = [];
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
            payoutValue = 20 * pointPrice;
          }
        } else if (descLower.includes("nerve")) {
          payoutValue = 10 * pointPrice;
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

        benefits.push({
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
          payout_desc: benefitDesc + (isPassive ? " (Passive)" : ` every ${frequencyDays}d`),
          frequency_days: frequencyDays,
          payout_value: payoutValue,
          annual_payout_value: currentAnnualPayout || baseAnnualPayout,
          apr: currentApr || nextIncrementApr,
          next_increment_apr: nextIncrementApr,
          is_active: active_increments >= 1,
        });
      }
    }

    benefits.sort((a, b) => b.apr - a.apr);

    const snapshotPayload = {
      city_bank: {
        amount: bankAmount,
        profit: bankProfit,
        principal: bankPrincipal,
        timeleft: bankTimeleft,
        progress_pct: bankProgressPct,
        cayman_bank: caymanBank,
      },
      stocks: {
        total_value: stocksTotalValue,
        holdings,
        benefits,
      },
    };

    await db
      .insertInto("sentinel_portfolio_snapshot" as any)
      .values({
        data: JSON.stringify(snapshotPayload),
        created_at: new Date().toISOString(),
      })
      .execute();

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
  } catch (err) {
    console.error("[Portfolio] Error updating portfolio snapshot:", err);
  }
}

