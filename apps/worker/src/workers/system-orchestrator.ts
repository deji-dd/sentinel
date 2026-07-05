/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "system_orchestrator";
const logger = new Logger(WORKER_NAME);

interface SnapshotRow {
  id: string;
  created_at: string;
}

async function runPruningJobs(db: any): Promise<void> {
  logger.info("Running system pruning jobs...");

  const nowMs = Date.now();

  // 1. Prune User Snapshots: keep 30s snapshots for 7 days, keep hourly snapshots forever
  try {
    const oneWeekAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    const snapshotsToKeep = new Set<string>();
    const seenHours = new Set<string>();
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    let deletedSnapshotsCount = 0;
    const SNAPSHOT_PRUNE_BATCH_SIZE = 5000;

    while (true) {
      let query = db
        .selectFrom(TABLE_NAMES.USER_SNAPSHOTS)
        .select(["id", "created_at"])
        .where("created_at", "<", oneWeekAgo);

      if (cursorCreatedAt && cursorId) {
        query = query.where((eb: any) =>
          eb.or([
            eb("created_at", ">", cursorCreatedAt),
            eb.and([
              eb("created_at", "=", cursorCreatedAt),
              eb("id", ">", cursorId),
            ]),
          ])
        );
      }

      const batch = (await query
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .limit(SNAPSHOT_PRUNE_BATCH_SIZE)
        .execute()) as SnapshotRow[];

      if (!batch.length) {
        break;
      }

      for (const snapshot of batch) {
        const date = new Date(snapshot.created_at);
        const hourKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;

        if (!seenHours.has(hourKey)) {
          seenHours.add(hourKey);
          snapshotsToKeep.add(snapshot.id);
        }
      }

      const idsToDelete = batch
        .filter((snapshot) => !snapshotsToKeep.has(snapshot.id))
        .map((snapshot) => snapshot.id);

      if (idsToDelete.length > 0) {
        await db
          .deleteFrom(TABLE_NAMES.USER_SNAPSHOTS)
          .where("id", "in", idsToDelete)
          .execute();
        deletedSnapshotsCount += idsToDelete.length;
      }

      const lastRow = batch[batch.length - 1];
      cursorCreatedAt = lastRow.created_at;
      cursorId = lastRow.id;
    }
    if (deletedSnapshotsCount > 0) {
      logger.success(`Pruned ${deletedSnapshotsCount} old user snapshots.`);
    }
  } catch (err) {
    logger.error("Failed to prune user snapshots", err);
  }

  // 2. Prune Battlestats Snapshots (older than 180 days)
  try {
    const cutoff180DaysAgo = new Date(nowMs - 180 * 24 * 60 * 60 * 1000).toISOString();
    const result = await db
      .deleteFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .where("created_at", "<", cutoff180DaysAgo)
      .executeTakeFirst();
    const deletedCount = Number(result.numDeletedRows || 0);
    if (deletedCount > 0) {
      logger.success(`Pruned ${deletedCount} battlestats snapshots older than 180 days.`);
    }
  } catch (err) {
    logger.error("Failed to prune battlestats snapshots", err);
  }

  // 3. Prune Worker Logs (older than 30 days)
  try {
    const cutoff30DaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await db
      .deleteFrom(TABLE_NAMES.WORKER_LOGS)
      .where("created_at", "<", cutoff30DaysAgo)
      .executeTakeFirst();
    const deletedCount = Number(result.numDeletedRows || 0);
    if (deletedCount > 0) {
      logger.success(`Pruned ${deletedCount} worker logs older than 30 days.`);
    }
  } catch (err) {
    logger.error("Failed to prune worker logs", err);
  }

  // 4. Prune Rate Limit Tracker entries (older than 2 hours)
  try {
    const cutoff2HoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    await db
      .deleteFrom(TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER)
      .where("requested_at", "<", cutoff2HoursAgo)
      .execute();
  } catch (err) {
    logger.error("Failed to prune rate limits", err);
  }

  // 5. Prune War Ledger entries (older than 180 days)
  try {
    const cutoffWarLedger180DaysAgo = new Date(nowMs - 180 * 24 * 60 * 60 * 1000).toISOString();
    const result = await db
      .deleteFrom(TABLE_NAMES.WAR_LEDGER)
      .where("end_time", "<", cutoffWarLedger180DaysAgo)
      .execute();
    const deletedCount = Number(result.numDeletedRows || 0);
    if (deletedCount > 0) {
      logger.success(`Pruned ${deletedCount} war ledger entries older than 180 days.`);
    }
  } catch (err) {
    logger.error("Failed to prune war ledger entries", err);
  }
}

async function syncCompanyProfit(db: any, apiKey: string): Promise<string | null> {
  const tctHour = new Date().getUTCHours();
  if (tctHour < 18) {
    return null; // Not time yet (Company logs update at 18:00 TCT)
  }

  const todayDate = new Date().toISOString().split("T")[0];

  // Load scheduler metadata to check if already completed today
  const schedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES as any)
    .select(["metadata"])
    .where("worker_id", "=", (qb: any) =>
      qb.selectFrom(TABLE_NAMES.WORKERS as any).select("id").where("name", "=", WORKER_NAME)
    )
    .executeTakeFirst();

  let lastCompanySyncDate = "";
  if (schedule?.metadata) {
    try {
      const parsed = JSON.parse(schedule.metadata);
      lastCompanySyncDate = String(parsed.last_company_sync_date || "");
    } catch {}
  }

  if (lastCompanySyncDate === todayDate) {
    return null; // Already completed today
  }

  const nowTime = new Date();
  const startOfToday1800TCT = Math.floor(Date.UTC(nowTime.getUTCFullYear(), nowTime.getUTCMonth(), nowTime.getUTCDate(), 18, 0, 0) / 1000);

  // Check if a company report/log has landed in raw user logs since 18:00 TCT
  const companyLog = await db
    .selectFrom(TABLE_NAMES.USER_LOGS as any)
    .select("log_id")
    .where("timestamp", ">=", startOfToday1800TCT)
    .where((eb: any) =>
      eb.or([
        eb("category", "like", "%company%"),
        eb("title", "like", "%company%")
      ])
    )
    .executeTakeFirst();

  if (!companyLog) {
    logger.info("TCT time is 18:00+ but no company rollover logs have been crawled yet. Postponing company profile sync.");
    return null;
  }

  logger.info(`Detected company rollover log. Syncing company profit/wages for ${todayDate}...`);

  try {
    const companyResponse = await tornApi.getRaw<any>("/company", apiKey, {
      selections: "detailed,employees",
    }).catch(() => null);

    if (!companyResponse || !companyResponse.company_detailed) {
      logger.warn("User is not in a company or company profile endpoint failed.");
      return todayDate; // Save status anyway to avoid repeated fails
    }

    const companyAdBudget = companyResponse.company_detailed.advertising_budget || 0;
    
    let companyWages = 0;
    if (companyResponse.company_employees) {
      for (const employeeId in companyResponse.company_employees) {
        const emp = companyResponse.company_employees[employeeId];
        if (emp && typeof emp.wage === "number") {
          companyWages += emp.wage;
        }
      }
    }

    // Fetch the latest company news log using type-safe v2 client to extract today's gross income
    const newsResponse = await tornApi.get("/company/news", { apiKey }).catch(() => null);
    let grossIncome = 0;

    if (newsResponse?.news) {
      // Find the most recent gross income news report
      const reports = newsResponse.news.filter((item: any) =>
        item.text.toLowerCase().includes("gross income of")
      );
      if (reports.length > 0) {
        const latestReport = reports[0];
        const match = latestReport.text.match(/gross income of \$([\d,]+)/i);
        if (match) {
          grossIncome = parseInt(match[1].replace(/,/g, ""), 10);
        }
      }
    }

    // Insert or update daily snapshot
    const existingSnap = await db
      .selectFrom("sentinel_daily_finance_snapshots")
      .selectAll()
      .where("date", "=", todayDate)
      .executeTakeFirst();

    if (existingSnap) {
      const inflow = Number(existingSnap.inflow || 0);
      const outflow = Number(existingSnap.outflow || 0);
      const netProfit = inflow - outflow;

      await db
        .updateTable("sentinel_daily_finance_snapshots")
        .set({
          company_income: grossIncome,
          company_wages: companyWages,
          company_ad_budget: companyAdBudget,
          company_profit_locked: 1,
          net_profit: netProfit + (grossIncome - companyWages - companyAdBudget),
          updated_at: new Date().toISOString(),
        })
        .where("date", "=", todayDate)
        .execute();
    } else {
      await db
        .insertInto("sentinel_daily_finance_snapshots")
        .values({
          date: todayDate,
          asset_valuation: 0,
          liquid_capital: 0,
          estimated_networth: 0,
          inflow: 0,
          outflow: 0,
          net_profit: grossIncome - companyWages - companyAdBudget,
          company_income: grossIncome,
          company_wages: companyWages,
          company_ad_budget: companyAdBudget,
          company_profit_locked: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }

    logger.success(`Company sync completed for ${todayDate}. Profit logged: $${grossIncome.toLocaleString()}`);
    return todayDate;
  } catch (err) {
    logger.error("Failed syncing company daily profit", err);
    return null;
  }
}

async function compileDailyGymSummaries(db: any): Promise<void> {
  logger.info("Compiling daily gym summaries...");
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartUnix = Math.floor(todayStart.getTime() / 1000);

    const logs = await db
      .selectFrom("sentinel_gym_train_logs")
      .select(["stat", "gain", "energy", "happy", "timestamp"])
      .where("timestamp", "<", todayStartUnix)
      .execute();

    if (logs.length === 0) {
      return;
    }

    const dailyGroups = new Map<string, any[]>();
    for (const log of logs) {
      const dateStr = new Date(Number(log.timestamp) * 1000).toISOString().split("T")[0];
      if (!dailyGroups.has(dateStr)) {
        dailyGroups.set(dateStr, []);
      }
      dailyGroups.get(dateStr)!.push(log);
    }

    for (const [dateStr, dayLogs] of dailyGroups.entries()) {
      let strength = 0;
      let defense = 0;
      let speed = 0;
      let dexterity = 0;
      let energy = 0;
      let happy = 0;

      for (const log of dayLogs) {
        const stat = String(log.stat).toLowerCase();
        const gain = Number(log.gain || 0);
        if (stat === "strength") strength += gain;
        else if (stat === "defense") defense += gain;
        else if (stat === "speed") speed += gain;
        else if (stat === "dexterity") dexterity += gain;

        energy += Number(log.energy || 0);
        happy += Number(log.happy || 0);
      }

      await db
        .insertInto("sentinel_daily_gym_summary" as any)
        .values({
          date: dateStr,
          strength_gain: strength,
          defense_gain: defense,
          speed_gain: speed,
          dexterity_gain: dexterity,
          energy_spent: energy,
          happy_spent: happy,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc: any) =>
          oc.column("date").doUpdateSet({
            strength_gain: strength,
            defense_gain: defense,
            speed_gain: speed,
            dexterity_gain: dexterity,
            energy_spent: energy,
            happy_spent: happy,
            updated_at: new Date().toISOString(),
          })
        )
        .execute();
    }
    logger.success(`Successfully compiled ${dailyGroups.size} daily gym summary rows.`);
  } catch (err) {
    logger.error("Failed compiling daily gym summaries", err);
  }
}

export async function orchestrateSystem(): Promise<void> {
  const db = getKysely();
  const apiKey = await getSystemApiKey("personal");

  // 1. Run database cleanup and pruning
  await runPruningJobs(db);

  // 2. Compile daily summaries for completed days
  await compileDailyGymSummaries(db);

  // 3. Daily Company sync check
  const completedDate = await syncCompanyProfit(db, apiKey);
  if (completedDate) {
    // Update scheduler metadata
    await db
      .updateTable(TABLE_NAMES.WORKER_SCHEDULES as any)
      .set({
        metadata: JSON.stringify({
          last_company_sync_date: completedDate,
        }),
        updated_at: new Date().toISOString(),
      })
      .where("worker_id", "=", (qb: any) =>
        qb.selectFrom(TABLE_NAMES.WORKERS as any).select("id").where("name", "=", WORKER_NAME)
      )
      .execute();
  }
}

export function startSystemOrchestrator(): void {
  const isDev = process.env.NODE_ENV === "development" || process.env.SENTINEL_DEV === "true";
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: isDev ? 60 : 600, // 1 minute in dev, 10 minutes in prod
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 300000, // 5 minutes
        handler: orchestrateSystem,
      });
    },
  });
}
