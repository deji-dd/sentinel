import { Logger } from "@sentinel/utils";
import { db, Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { tornApiManager, getPersonalKey } from "@sentinel/torn-api-manager";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "company_sync";
const logger = new Logger(WORKER_NAME);

/**
 * Fetches company profile & employee data, calculates daily net profit,
 * and records snapshot to CompanyDailyProfit and LedgerEvent.
 */
export async function syncCompanyDailyProfit(): Promise<void> {
  const finishSync = logger.time();

  try {
    const keyEntry = await getPersonalKey();
    if (!keyEntry) {
      logger.warn("No personal API key found for company sync. Skipping.");
      return;
    }

    const rawRes = (await tornApiManager.get("/company", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams: { selections: ["profile", "employees"] },
    })) as TornSchema<"CompanyProfileExtendedResponse"> &
      TornSchema<"CompanyEmployeesResponse">;

    const profile = rawRes.profile;
    const employees = rawRes.employees;

    if (!profile || !employees) {
      logger.warn("Company sync response missing profile or employees data.");
      return;
    }

    const inflow = profile.income?.daily ?? 0;
    let outflow = profile.advertisement_budget ?? 0;
    for (const employee of employees) {
      const wage = "wage" in employee ? (employee.wage ?? 0) : 0;
      outflow += wage;
    }

    const profit = inflow - outflow;
    const now = new Date();
    const timestampStr = Math.floor(now.getTime() / 1000).toString();

    // 1. Insert snapshot into CompanyDailyProfit
    await db.companyDailyProfit.create({
      data: {
        id: `company_daily_profit_${timestampStr}_${crypto.randomUUID()}`,
        timestamp: now,
        inflow,
        outflow,
        profit,
        profile: profile as unknown as object,
        employees: employees as unknown as object,
        createdAt: now,
      },
    });

    // 2. Record financial transaction into LedgerEvent
    await db.ledgerEvent.create({
      data: {
        id: `ledger_ev_company_profit_${timestampStr}`,
        logId: "0",
        timestamp: now,
        type: profit >= 0 ? "injection" : "loss",
        categoryId: 9,
        transactionName: "Daily Company Profit/Loss",
        assetsAffected: [],
        cashFlow: 0,
        realizedPnl: profit,
        rawLog: Prisma.JsonNull,
        createdAt: now,
        updatedAt: now,
      },
    });

    logger.info(
      `Successfully synced daily company profit: $${profit.toLocaleString()} in ${finishSync()}`,
    );
  } catch (error) {
    logger.error("Failed to sync company data:", error);
  }
}

/**
 * Registers company alarm listener to sync profit when company pay is received.
 */
export function startCompanyModule(_options?: WorkerStartOptions): void {
  workerEvents.on("company_pay_received", async () => {
    await syncCompanyDailyProfit();
  });

  logger.info("Company module registered and listening for pay events.");
}
