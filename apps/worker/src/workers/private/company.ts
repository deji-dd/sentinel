import {
  getWorkerApiKey,
  LedgerEvents,
  tornApi,
  TornSchema,
} from "@sentinel/shared";
import { Logger, CompanyDailyProfits } from "@sentinel/shared";
import { randomUUID } from "crypto";
import { workerEvents } from "../../lib/event-bus.js";

const logger = new Logger("company_sync");

async function syncCompanyDailyProfit(): Promise<void> {
  const finishSync = logger.time();
  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const rawRes = await tornApi.get("/company", {
      apiKey,
      queryParams: { selections: ["profile", "employees"] },
    });

    const res = rawRes as TornSchema<"CompanyProfileResponseMixed"> &
      TornSchema<"CompanyEmployeesResponse">;
    const profile = res.profile as
      | TornSchema<"CompanyProfileExtended">
      | undefined;
    const employees = res.employees as
      | TornSchema<"CompanyEmployeeFull">[]
      | undefined;

    if (!profile || !employees) {
      logger.warn("Company sync response missing profile or employees data.");
      return;
    }

    const inflow = profile.income.daily;
    let outflow = profile.advertisement_budget;
    for (const employee of employees) {
      outflow += employee.wage;
    }

    const profit = inflow - outflow;
    const timestamp = Math.floor(Date.now() / 1000);

    CompanyDailyProfits.insertOne({
      id: `company_daily_profit_${timestamp}_${randomUUID()}`,
      timestamp,
      inflow,
      outflow,
      profit,
      profile,
      employees,
    });

    LedgerEvents.insertOne({
      id: `ledger_ev_company_profit_${timestamp}`,
      log_id: "0", // System-generated
      timestamp,
      type: profit >= 0 ? "injection" : "loss",
      category_id: 9,
      transaction_name: "Daily Company Profit/Loss",
      assets_affected: [],
      cash_flow: 0,
      realized_pnl: profit,
      raw_log: null,
    });

    logger.info(
      `Successfully synced daily company profit: $${profit} in ${finishSync()}`,
    );
  } catch (error) {
    logger.error("Failed to sync company data:", error);
  }
}

export function registerCompanyAlarmClock() {
  workerEvents.on(
    "company_pay_received",
    async () => await syncCompanyDailyProfit(),
  );
}
