/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
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
  "bounties",
  "bounty"
]);

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

    inserted++;
  }
  return inserted;
}

export async function syncUserInventory(db: any, client: any, apiKey: string): Promise<void> {
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
          logger.error(`[Inventory Sync] Failed to fetch category ${cat}:`, e);
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
    logger.error("[Inventory Sync] Error syncing inventory:", err);
  }
}

async function updateDailySnapshot(db: any, apiKey: string): Promise<void> {
  try {
    const [moneyResponse, userResponse, companyResponse, userStocksResponse, tornStocksResponse] = (await Promise.all([
      tornApi.get("/user/money" as any, { apiKey }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch money:", e);
        return null;
      }),
      tornApi.get("/user" as any, {
        apiKey,
        queryParams: { selections: ["networth", "bazaar", "display", "itemmarket"] }
      }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch user networth/items:", e);
        return null;
      }),
      tornApi.get("/company/profile" as any, { apiKey }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch company profile:", e);
        return null;
      }),
      tornApi.get("/user/stocks" as any, { apiKey }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch user stocks:", e);
        return null;
      }),
      tornApi.get("/torn/stocks" as any, { apiKey }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch torn stocks:", e);
        return null;
      })
    ])) as any[];

    const networthTotal = userResponse?.networth?.total || moneyResponse?.money?.daily_networth || 0;
    const wallet = moneyResponse?.money?.wallet || 0;
    const vault = moneyResponse?.money?.vault || 0;
    const pointsQuantity = moneyResponse?.money?.points || 0;

    // Load point price from db or fallback
    const marketPrices = await db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []);
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key, Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;
    const pointsValue = pointsQuantity * pointPrice;

    // Company profile & employees
    let companyFunds = 0;
    let companyAdBudget = 0;
    let companyWages = 0;

    const companyId = companyResponse ? Number(companyResponse.profile?.company_id || 0) : 0;
    if (companyId > 0 && companyResponse) {
      companyFunds = companyResponse.profile.funds || 0;
      companyAdBudget = Number((companyResponse.profile as any).advertisement_budget || 0);

      // Securely fetch company employees ONLY if companyId > 0
      const companyEmployeesResponse = (await tornApi.get("/company/employees" as any, { apiKey }).catch((e) => {
        logger.error("[Snapshot] Failed to fetch company employees:", e);
        return null;
      })) as any;

      const empList = Array.isArray(companyEmployeesResponse)
        ? companyEmployeesResponse
        : (companyEmployeesResponse?.employees || []);

      for (const emp of empList) {
        companyWages += Number((emp as any).wage || 0);
      }
    }

    const companyWithdrawable = Math.max(0, companyFunds - (companyWages * 7) - (companyAdBudget * 7));
    const liquidCapital = wallet + vault + pointsValue + companyWithdrawable;

    // Asset Valuation
    // 1. Properties
    const propertiesResponse = (await tornApi.get("/user/properties" as any, {
      apiKey,
      queryParams: { filters: "ownedByUser" }
    }).catch((e) => {
      logger.error("[Snapshot] Failed to fetch properties:", e);
      return null;
    })) as any;

    let propertiesTotalValue = 0;
    if (propertiesResponse?.properties) {
      for (const prop of propertiesResponse.properties) {
        const val = prop.market_price || prop.value || (Number(prop.property) === 13 ? 475000000 : 0);
        propertiesTotalValue += val;
      }
    }

    // 2. Inventory (database cached)
    const dbInventory = await db
      .selectFrom("sentinel_user_assets" as any)
      .selectAll()
      .where("asset_type", "=", "item")
      .execute()
      .catch(() => []);

    // Load items map
    const items = await db.selectFrom("sentinel_torn_items").select(["item_id", "name", "value"]).execute().catch(() => []);
    const itemMap = new Map<number, { name: string; value: number }>();
    const itemNameMap = new Map<string, { item_id: number; name: string; value: number }>();
    for (const item of items) {
      const info = { name: item.name, value: Number(item.value || 0) };
      itemMap.set(Number(item.item_id), info);
      itemNameMap.set(item.name.toLowerCase(), { item_id: Number(item.item_id), ...info });
    }

    let inventoryTotalValue = 0;
    for (const row of dbInventory) {
      const itemId = Number(row.asset_key);
      const qty = Number(row.quantity || 0);
      if (!itemId || qty <= 0) continue;
      const itemVal = itemMap.get(itemId)?.value || 0;
      inventoryTotalValue += itemVal * qty;
    }

    // Include bazaar, display, itemmarket items
    const bazaarItems = userResponse?.bazaar || [];
    for (const item of bazaarItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemVal = item.market_price || itemMap.get(itemId)?.value || 0;
      inventoryTotalValue += itemVal * qty;
    }

    const displayItems = userResponse?.display || [];
    for (const item of displayItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemVal = item.market_price || itemMap.get(itemId)?.value || 0;
      inventoryTotalValue += itemVal * qty;
    }

    const itemMarketItems = userResponse?.itemmarket || [];
    for (const item of itemMarketItems) {
      const itemId = Number(item.ID || item.id);
      const qty = Number(item.quantity || 1);
      const itemVal = item.market_price || itemMap.get(itemId)?.value || 0;
      inventoryTotalValue += itemVal * qty;
    }

    // 3. Stocks Value
    let stocksTotalValue = 0;
    if (userStocksResponse?.stocks && tornStocksResponse?.stocks) {
      const priceMap = new Map<number, number>();
      for (const stock of tornStocksResponse.stocks) {
        priceMap.set(Number(stock.id), Number(stock.market?.price || 0));
      }
      for (const holding of userStocksResponse.stocks) {
        const stockId = Number(holding.id);
        const shares = Number(holding.shares || 0);
        const price = priceMap.get(stockId) || 0;
        stocksTotalValue += shares * price;
      }
    }

    const companyTotalVal = userResponse?.networth?.company ?? companyFunds;
    const assetValuation = propertiesTotalValue + inventoryTotalValue + companyTotalVal + stocksTotalValue;

    // Today's log calculations (P&L)
    const nowTime = new Date();
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
      itemNameMap,
      pointPrice
    );

    const netProfit = income.total - expenses.total;

    // Formatted date
    const dateStr = nowTime.toISOString().split("T")[0]; // YYYY-MM-DD in UTC (since TCT is UTC)

    // Upsert into DB
    await db
      .insertInto("sentinel_daily_finance_snapshots" as any)
      .values({
        date: dateStr,
        estimated_networth: networthTotal,
        liquid_capital: liquidCapital,
        asset_valuation: assetValuation,
        net_profit: netProfit,
        inflow: income.total,
        outflow: expenses.total,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc: any) =>
        oc.column("date").doUpdateSet({
          estimated_networth: networthTotal,
          liquid_capital: liquidCapital,
          asset_valuation: assetValuation,
          net_profit: netProfit,
          inflow: income.total,
          outflow: expenses.total,
          updated_at: new Date().toISOString(),
        })
      )
      .execute();

    logger.success(`[Snapshot] Successfully updated daily finance snapshot for ${dateStr}. Networth: ${networthTotal.toLocaleString()}, Net Profit: ${netProfit.toLocaleString()}`);

  } catch (error) {
    logger.error("[Snapshot] Error taking daily finance snapshot:", error);
  }
}

async function updatePortfolioSnapshot(db: any, apiKey: string): Promise<void> {
  try {
    const [moneyResponse, userStocksResponse, tornStocksResponse, marketPrices, dbItems] = (await Promise.all([
      tornApi.get("/user/money" as any, { apiKey }).catch((e) => {
        logger.error("[Portfolio] Failed to fetch money for snapshot:", e);
        return null;
      }),
      tornApi.get("/user/stocks" as any, { apiKey }).catch((e) => {
        logger.error("[Portfolio] Failed to fetch user stocks for snapshot:", e);
        return null;
      }),
      tornApi.get("/torn/stocks" as any, { apiKey }).catch((e) => {
        logger.error("[Portfolio] Failed to fetch torn stocks for snapshot:", e);
        return null;
      }),
      db.selectFrom(TABLE_NAMES.MARKET_PRICES).select(["key", "value"]).execute().catch(() => []),
      db.selectFrom("sentinel_torn_items" as any).select(["name", "value"]).execute().catch(() => [])
    ])) as any[];

    // Build market price maps
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key.toLowerCase(), Number(row.value));
    }
    for (const item of dbItems || []) {
      priceMap.set(item.name.toLowerCase(), Number(item.value || 0));
    }
    const pointPrice = priceMap.get("points") ?? 31000;

    // Process City Bank Investment
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

    // Process Stock Benefit Blocks and Holdings
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
    // Calculate total stock value and build holdings list with average buy price / P&L
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

    // Process each stock returned by Torn API
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        // Skip if there's no bonus or the bonus is not a benefit block (requirement is 0/undefined)
        if (!stock.bonus || !stock.bonus.requirement || stock.bonus.requirement <= 0) {
          continue;
        }

        const stockId = Number(stock.id);
        const acronym = stock.acronym;
        const name = stock.name;
        const currentPrice = stock.market?.price || 0;
        const requirement = Number(stock.bonus.requirement); // base requirement
        const frequencyDays = Number(stock.bonus.frequency || 0);
        const isPassive = !!stock.bonus.passive;
        const benefitDesc = stock.bonus.description || "";

        const heldShares = heldStocksMap.get(stockId) || 0;

        // Calculate increments
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
            payoutValue = 20 * pointPrice; // 100 energy valued at 20 points
          }
        } else if (descLower.includes("nerve")) {
          payoutValue = 10 * pointPrice; // 50 nerve valued at 10 points
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

    // Sort by APR/ROI descending
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

    // Store in DB
    await db
      .insertInto("sentinel_portfolio_snapshot" as any)
      .values({
        data: JSON.stringify(snapshotPayload),
        created_at: new Date().toISOString(),
      })
      .execute();

    // Clean up old snapshots (keep last 5 for safety)
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

    logger.success(`[Portfolio] Successfully cached new portfolio snapshot.`);
  } catch (err) {
    logger.error("[Portfolio] Error updating portfolio snapshot:", err);
  }
}

export async function syncFinanceLogs(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    logger.error("No personal API key found, skipping finance logs sync.");
    return;
  }
  const db = getKysely();

  // 1. Sync User Inventory items
  logger.info("Syncing user inventory items...");
  await syncUserInventory(db, tornApi, apiKey);

  // 2. Find the latest timestamp in sentinel_financial_logs
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

  logger.info(`Starting finance logs forward sync. Checking from timestamp ${fromTimestamp} to ${toTimestamp}...`);

  let countNewLogs = 0;

  // 3. Forward sync batch loop (fetching newer logs since last sync using descending pagination)
  let forwardHasMore = true;
  let currentForwardTo = Math.floor(Date.now() / 1000);
  let forwardPages = 0;
  const MAX_FORWARD_PAGES = 10; // Safe maximum pages to query per run (1000 logs)

  while (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
    try {
      logger.info(`Fetching logs page ${forwardPages + 1} (from ${fromTimestamp} to ${currentForwardTo})...`);
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
        logger.info("No more log entries found in this range.");
        forwardHasMore = false;
        break;
      }

      logger.info(`Fetched batch of ${logs.length} log entries.`);
      const inserted = await saveLogBatch(db, logs);
      countNewLogs += inserted;

      if (logs.length < 100) {
        logger.info("Reached end of log entries for this range.");
        forwardHasMore = false;
      } else {
        const oldestInBatch = logs[logs.length - 1];
        const oldestTimestamp = Number(oldestInBatch.timestamp);
        currentForwardTo = oldestTimestamp - 1;
        if (currentForwardTo < fromTimestamp) {
          forwardHasMore = false;
        }
      }

      forwardPages++;
      if (forwardHasMore && forwardPages < MAX_FORWARD_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (apiError) {
      logger.error("Failed syncing logs page from Torn API", apiError);
      forwardHasMore = false;
    }
  }

  if (countNewLogs > 0) {
    logger.success(`Successfully synced ${countNewLogs} new financial log entries.`);
  } else {
    logger.info("Financial logs are up to date.");
  }

  // Trigger daily finance snapshot update
  await updateDailySnapshot(db, apiKey);
  // Trigger portfolio snapshot update
  await updatePortfolioSnapshot(db, apiKey);
}

export function startTornFinanceLogsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 900, // Every 15 minutes
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: syncFinanceLogs,
      });
    },
  });
}
