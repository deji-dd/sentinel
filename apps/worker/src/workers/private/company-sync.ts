import {
  Logger,
  TornSchema,
  tornApi,
  getWorkerApiKey,
  CompanyDailyProfits,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";
import { randomUUID } from "crypto";

const WORKER_NAME = "company_sync";
const logger = new Logger(WORKER_NAME);

export function startCompanySyncWorker(): void {
  logger.info("Initializing Company Sync listener");

  workerEvents.on("NEW_PERSONAL_LOG", async (log: TornSchema<"UserLog">) => {
    // 6222 represents "Company director pay" log type
    if (log.details.id === 6222) {
      const finishSync = logger.time();

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
          logger.warn(
            "Company sync response missing profile or employees data.",
          );
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

        // --- Link to the Torn Finance Ledger ---
        const companyAssetId = `company_${profile.id}`;
        const existingAssets = Assets.find({
          asset_id: companyAssetId,
          owner: "personal",
        });
        let assetDoc: AssetDocument;

        if (existingAssets.length > 0) {
          assetDoc = existingAssets[0];
          assetDoc.total_cost_basis += profit;
          assetDoc.moving_average_cost =
            assetDoc.total_cost_basis / (assetDoc.quantity || 1);
          assetDoc.last_updated = Date.now();
          Assets.update(assetDoc);
        } else {
          // If the company wasn't tracked yet (e.g. bought before ledger started), we create it
          assetDoc = {
            id: `equity_${companyAssetId}_${randomUUID()}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: "company" as any,
            asset_id: companyAssetId,
            quantity: 1,
            moving_average_cost: profit,
            total_cost_basis: profit,
            location: "portfolio",
            owner: "personal",
            origin: "company_sync",
            realized_pnl: 0,
            last_updated: Date.now(),
          };
          Assets.insertOne(assetDoc);
        }

        LedgerEvents.insertOne({
          id: `ledger_ev_company_profit_${log.id}`,
          log_id: log.id,
          timestamp: log.timestamp,
          type: profit >= 0 ? "injection" : "loss",
          category_id: 9, // Category 9: Equities, Real Estate & Companies
          transaction_name: "Daily Company Profit/Loss",
          assets_affected: [
            {
              asset_id: companyAssetId,
              quantity_change: 0, // Intrinsic value increases, quantity remains 1
              cost_basis_impact: profit,
            },
          ],
          cash_flow: 0, // No cash left the company into personal wallet
          realized_pnl: profit, // The player recognized this profit/loss intrinsically
          raw_log: log,
        });

        finishSync();
      } catch (error) {
        finishSync();
        logger.error("Failed to sync company data:", error);
      }
    }
  });
}
