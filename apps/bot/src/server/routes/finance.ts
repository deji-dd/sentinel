/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Request, type Response } from "express";
import { TABLE_NAMES, parseFinanceLedger } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { getServerContext } from "../context.js";

export const financeRouter = Router();





financeRouter.get("/ledger", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    // 1. Fetch item prices and points valuation from DB
    const items = await db
      .selectFrom(TABLE_NAMES.TORN_ITEMS)
      .select(["item_id", "name", "value", "image", "type"])
      .execute();

    const itemMap = new Map<
      number,
      { name: string; value: number; image: string; type: string }
    >();
    const itemNameMap = new Map<
      string,
      {
        item_id: number;
        name: string;
        value: number;
        image: string;
        type: string;
      }
    >();
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
    const startOfTodayTCT = Math.floor(
      Date.UTC(
        nowTime.getUTCFullYear(),
        nowTime.getUTCMonth(),
        nowTime.getUTCDate(),
      ) / 1000,
    );

    // 2. Fetch logged transactions from DB
    const dbLogs = await db
      .selectFrom("sentinel_financial_logs" as any)
      .selectAll()
      .where("timestamp", ">=", startOfTodayTCT)
      .orderBy("timestamp", "desc")
      .execute();

    // 3. Parse P&L Ledger transactions using shared parser
    const { income, expenses, transactions } = parseFinanceLedger(
      dbLogs as any[],
      itemMap,
      itemNameMap,
      pointPrice,
    );

    const dateStr = nowTime.toISOString().split("T")[0];
    const todaySnap = await db
      .selectFrom("sentinel_daily_finance_snapshots")
      .selectAll()
      .where("date", "=", dateStr)
      .executeTakeFirst();

    if (todaySnap && Number(todaySnap.company_profit_locked || 0) === 1) {
      const snapCompIncome = Number(todaySnap.company_income || 0);
      const snapCompWages = Number(todaySnap.company_wages || 0);
      const snapCompAds = Number(todaySnap.company_ad_budget || 0);

      if (snapCompIncome > 0) {
        income.company = (income.company || 0) + snapCompIncome;
        income.total += snapCompIncome;

        const lockTimestamp = startOfTodayTCT + (18 * 3600) + (3 * 60);

        transactions.push({
          id: `synth_comp_income_${lockTimestamp}`,
          timestamp: lockTimestamp,
          type: "income",
          category: "company",
          title: "Company Daily Income",
          amount: snapCompIncome,
          description: `Daily cycle revenue for company`,
        });

        const totalCompExpenses = snapCompWages + snapCompAds;
        if (totalCompExpenses > 0) {
          (expenses as any).company_expenses = ((expenses as any).company_expenses || 0) + totalCompExpenses;
          expenses.total += totalCompExpenses;
        }

        if (snapCompWages > 0) {
          transactions.push({
            id: `synth_comp_wages_${lockTimestamp}`,
            timestamp: lockTimestamp,
            type: "expense",
            category: "company_expenses",
            title: "Company Daily Wages",
            amount: snapCompWages,
            description: `Employee salaries paid from vault`,
          });
        }

        if (snapCompAds > 0) {
          transactions.push({
            id: `synth_comp_ads_${lockTimestamp}`,
            timestamp: lockTimestamp,
            type: "expense",
            category: "company_expenses",
            title: "Company Advertising Bill",
            amount: snapCompAds,
            description: `Daily marketing spend`,
          });
        }

        transactions.sort((a, b) => b.timestamp - a.timestamp);
      }
    }

    // 4. Fetch latest portfolio snapshot from DB (worker synced this)
    const latestSnapshot = await db
      .selectFrom("sentinel_portfolio_snapshot" as any)
      .selectAll()
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

    const snapshotData = latestSnapshot ? JSON.parse(latestSnapshot.data) : {};

    // 5. Parse Asset Ledger details from cached snapshot
    const wallet = snapshotData?.liquid?.wallet || 0;
    const pointsQuantity = snapshotData?.liquid?.points || 0;
    const pointsValue = pointsQuantity * pointPrice;
    const vault = snapshotData?.liquid?.vault || 0;
    const companyWithdrawable = snapshotData?.liquid?.company_withdrawable || 0;

    // Load inventory from cached snapshot
    const inventoryList: any[] = snapshotData?.inventory?.items || [];
    const inventoryTotalValue = snapshotData?.inventory?.total_value || 0;

    // Load properties from cached snapshot
    const propertiesList: any[] = snapshotData?.properties?.properties || [];
    const propertiesTotalValue = snapshotData?.properties?.total_value || 0;

    // Load company from cached snapshot
    const companyName = snapshotData?.company?.name || "No Company";
    const companyFunds = snapshotData?.company?.funds || 0;
    const companyDailyIncome = snapshotData?.company?.daily_income || 0;
    const companyAdBudget = snapshotData?.company?.daily_ad_budget || 0;
    const companyWages = snapshotData?.company?.daily_wages || 0;
    const companyDailyProfit = snapshotData?.company?.daily_profit || 0;

    // Load stocks from cached snapshot
    const stocksList: any[] = snapshotData?.stocks?.items || [];
    const stocksTotalValue = snapshotData?.stocks?.total_value || 0;

    const liquidValue = wallet + vault + pointsValue + companyWithdrawable;
    const totalAssetsValue =
      snapshotData?.total_value ||
      liquidValue +
        inventoryTotalValue +
        propertiesTotalValue +
        companyFunds +
        stocksTotalValue;

    const scheduleRow = await db
      .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .innerJoin(
        TABLE_NAMES.WORKERS,
        `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`,
        `${TABLE_NAMES.WORKERS}.id`,
      )
      .select([
        `${TABLE_NAMES.WORKER_SCHEDULES}.last_run_at as last_run_at`,
        `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`,
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
          total_value: snapshotData?.company?.networth_value ?? companyFunds,
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
        minTimestamp:
          dbLogs.length > 0
            ? Number(dbLogs[dbLogs.length - 1].timestamp)
            : null,
        maxTimestamp: dbLogs.length > 0 ? Number(dbLogs[0].timestamp) : null,
      },
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
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

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
      return res
        .status(404)
        .json({
          error:
            "No portfolio snapshot cached yet. Please wait for worker sync.",
        });
    }

    const payload = JSON.parse(latestSnapshot.data);
    payload.syncStatus = {
      lastSyncAt: latestSnapshot.created_at
    };
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
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

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
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const target = (req.body?.target || req.query?.target || "all") as string;
    
    let workerNames: string[] = [];
    if (target === "logs") {
      workerNames = ["torn_finance_logs_worker"];
    } else if (target === "portfolio") {
      workerNames = ["torn_portfolio_worker"];
    } else if (target === "gym") {
      workerNames = ["torn_gyms_worker"];
    } else if (target === "crimes") {
      workerNames = ["torn_crimes_worker"];
    } else if (target === "all") {
      workerNames = ["torn_finance_logs_worker", "torn_portfolio_worker", "torn_gyms_worker", "torn_crimes_worker"];
    }

    if (workerNames.length === 0) {
      return res.status(400).json({ error: "Invalid sync target specified" });
    }

    const workers = await db
      .selectFrom(TABLE_NAMES.WORKERS)
      .select("id")
      .where("name", "in", workerNames)
      .execute();

    if (workers.length === 0) {
      return res.status(500).json({ error: "Required workers not registered in database" });
    }

    const workerIds = workers.map(w => w.id);

    const startWait = Date.now();
    const nowIso = new Date().toISOString();

    // 2. Set force_run = 1 and reset next_run_at to now for coordinator to pick up
    await db
      .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
      .set({ force_run: 1, next_run_at: nowIso })
      .where("worker_id", "in", workerIds)
      .execute();

    console.log(`[HTTP] Triggered force run for target: ${target} (${workerIds.join(", ")}).`);

    // 3. Poll for up to 15 seconds to wait for worker completion
    let finished = false;
    for (let i = 0; i < 30; i++) { // 30 ticks * 500ms = 15s
      await new Promise((resolve) => setTimeout(resolve, 500));

      const schedules = await db
        .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
        .select(["worker_id", "force_run", "last_run_at"])
        .where("worker_id", "in", workerIds)
        .execute();

      const allDone = schedules.every((s: any) =>
        Number(s.force_run) === 0 &&
        s.last_run_at &&
        new Date(s.last_run_at).getTime() >= startWait
      );

      if (allDone && schedules.length === workerIds.length) {
        finished = true;
        break;
      }
    }

    if (finished) {
      res.json({
        success: true,
        message: `Manual sync complete for target: ${target}.`,
      });
    } else {
      res.json({
        success: true,
        message: `Sync for ${target} triggered in background.`,
      });
    }
  } catch (error) {
    console.error("[HTTP] Error forcing finance sync:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.get("/benefit-payouts", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    // Fetch the latest portfolio snapshot to get owned stock IDs
    const latestSnapshot = await db
      .selectFrom("sentinel_portfolio_snapshot" as any)
      .selectAll()
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();

    let ownedStockIds: number[] = [];
    if (latestSnapshot) {
      try {
        const payload = JSON.parse(latestSnapshot.data);
        const holdings = payload?.stocks?.holdings || [];
        ownedStockIds = holdings.map((h: any) => Number(h.id)).filter((id: number) => id > 0);
      } catch (err) {
        console.error("[HTTP] Failed parsing portfolio snapshot holdings:", err);
      }
    }

    let payouts: any[] = [];
    if (ownedStockIds.length > 0) {
      payouts = await db
        .selectFrom("sentinel_stock_benefit_payouts" as any)
        .selectAll()
        .where("stock_id", "in", ownedStockIds)
        .execute();
    }

    res.json(payouts);
  } catch (error) {
    console.error("[HTTP] Error fetching stock benefit payouts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.post("/debug-recalculate-today", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const nowTime = new Date();
    const dateStr = nowTime.toISOString().split("T")[0]; // YYYY-MM-DD
    const startOfTodayTCT = Math.floor(Date.UTC(nowTime.getUTCFullYear(), nowTime.getUTCMonth(), nowTime.getUTCDate()) / 1000);

    // 1. Delete today's logs from database
    await db
      .deleteFrom("sentinel_financial_logs" as any)
      .where("timestamp", ">=", startOfTodayTCT)
      .execute();

    // 2. Delete today's snapshot row
    await db
      .deleteFrom("sentinel_daily_finance_snapshots" as any)
      .where("date", "=", dateStr)
      .execute();

    // 3. Clear benefit payouts and processed benefit logs to rebuild with correct values
    await db.deleteFrom("sentinel_stock_benefit_payouts").execute();
    await db.deleteFrom("sentinel_processed_benefit_logs").execute();

    // 4. Reset logs worker backfill metadata so it re-scans the full log history
    await db
      .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
      .set({ metadata: null })
      .where("worker_id", "in", (qb) =>
        qb
          .selectFrom(TABLE_NAMES.WORKERS)
          .select("id")
          .where("name", "=", "torn_finance_logs_worker")
      )
      .execute();

    // 5. Find worker IDs to reschedule
    const workers = await db
      .selectFrom(TABLE_NAMES.WORKERS)
      .select(["id", "name"])
      .where("name", "in", ["torn_finance_logs_worker", "torn_portfolio_worker"])
      .execute();

    const nowIso = new Date().toISOString();
    for (const w of workers) {
      await db
        .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
        .set({ force_run: 1, next_run_at: nowIso })
        .where("worker_id", "=", w.id)
        .execute();
    }

    res.json({
      success: true,
      message: "Successfully cleared today's logs and daily snapshot, and triggered recalculation.",
    });
  } catch (error) {
    console.error("[HTTP] Error triggering recalculation:", error);
    res.status(500).json({ error: "Server error" });
  }
});

financeRouter.post("/fix-history", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session)
      return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    // 1. Fetch item prices and points valuation from DB
    const items = await db
      .selectFrom(TABLE_NAMES.TORN_ITEMS)
      .select(["item_id", "name", "value", "image", "type"])
      .execute();

    const itemMap = new Map<number, any>();
    const itemNameMap = new Map<string, any>();
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

    // 2. Fetch all daily finance snapshots
    const snapshots = await db
      .selectFrom("sentinel_daily_finance_snapshots")
      .selectAll()
      .orderBy("date", "asc")
      .execute();

    let fixedCount = 0;

    for (const snap of snapshots) {
      const dateStr = snap.date;
      const [year, month, day] = dateStr.split("-").map(Number);
      const startOfDateTCT = Math.floor(Date.UTC(year, month - 1, day) / 1000);
      const endOfDateTCT = startOfDateTCT + 24 * 60 * 60 - 1;

      // Read logs for this day from DB
      const dbLogs = await db
        .selectFrom("sentinel_financial_logs" as any)
        .selectAll()
        .where("timestamp", ">=", startOfDateTCT)
        .where("timestamp", "<=", endOfDateTCT)
        .execute()
        .catch(() => []);

      const { income, expenses } = parseFinanceLedger(
        dbLogs as any[],
        itemMap,
        itemNameMap,
        pointPrice,
      );

      const compIncome = Number(snap.company_income || 0);
      const compWages = Number(snap.company_wages || 0);
      const compAds = Number(snap.company_ad_budget || 0);

      const inflowTotal = income.total + compIncome;
      const outflowTotal = expenses.total + compWages + compAds;
      const netProfit = inflowTotal - outflowTotal;

      // Update the snapshot
      await db
        .updateTable("sentinel_daily_finance_snapshots")
        .set({
          inflow: inflowTotal,
          outflow: outflowTotal,
          net_profit: netProfit,
          updated_at: new Date().toISOString(),
        })
        .where("date", "=", dateStr)
        .execute();

      fixedCount++;
    }

    res.json({
      success: true,
      message: `Successfully recalculated and fixed P&L for ${fixedCount} daily snapshots in database.`,
    });
  } catch (error) {
    console.error("[HTTP] Error fixing finance snapshots:", error);
    res.status(500).json({ error: "Server error" });
  }
});


