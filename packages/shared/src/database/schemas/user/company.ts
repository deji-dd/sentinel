import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

/**
 * Represents a daily snapshot of a company's profile, employees, and calculated profit.
 */
export type CompanyDailyProfitDocument = BaseDocument & {
  timestamp: number;
  inflow: number;
  outflow: number;
  profit: number;

  profile: TornSchema<"CompanyProfileExtended">;
  employees: TornSchema<"CompanyEmployeeFull">[];
};

export const CompanyDailyProfits = new Collection<CompanyDailyProfitDocument>(
  sentinelDbEngine,
  "company_daily_profits",
);
