import {
  Logger,
  TornSchema,
  tornApi,
  getWorkerApiKey,
  CompanyDailyProfits,
  LedgerEvents,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

const WORKER_NAME = "company_profit_parser";
const logger = new Logger(WORKER_NAME);

export async function parseCompanyProfit(
  log: TornSchema<"UserLog">,
): Promise<void> {
  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // The endpoint is /company, selections profile and employees
    const rawRes = await tornApi.get("/company", {
      apiKey,
      queryParams: {
        selections: ["profile", "employees"],
      },
    });

    // Use casting here because the generic Torn API client returns a union of the possible selections
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

    // Calculate inflow (daily income)
    const inflow = profile.income.daily;

    // Calculate outflow (daily ad budget + all employee wages)
    let outflow = profile.advertisement_budget;

    for (const employee of employees) {
      outflow += employee.wage;
    }

    const profit = inflow - outflow;

    const doc = {
      id: `company_daily_profit_${Date.now()}_${randomUUID()}`,
      timestamp: Date.now(),
      inflow,
      outflow,
      profit,
      profile,
      employees,
    };

    CompanyDailyProfits.insertOne(doc);

    LedgerEvents.insertOne({
      id: `ledger_ev_company_profit_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: profit >= 0 ? "injection" : "loss",
      category_id: 9, // Category 9: Equities, Real Estate & Companies
      transaction_name: "Daily Company Profit/Loss",
      assets_affected: null,
      cash_flow: 0, // No cash left the company into personal wallet
      realized_pnl: profit, // The player recognized this profit/loss intrinsically
      raw_log: log,
    });
  } catch (error) {
    logger.error("Failed to sync company data:", error);
  }
}
