import { executeSync } from "../../lib/sync.js";
import {
  Logger,
  tornApi,
  getWorkerApiKey,
  WorkerSchedules,
  CashHistory,
  TornSchema,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

const WORKER_NAME = "liquid_cash_sync";
const logger = new Logger(WORKER_NAME);

// Run every 2 minutes
const CADENCE_SECONDS = 120;

async function executeLiquidCashEngine(): Promise<void> {
  const finishSync = logger.time();

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) {
      throw new Error("No personal API key found");
    }

    // 1. Fetch user money from Torn
    const userMoneyRes = await tornApi.get("/user/money", { apiKey });
    const money = (userMoneyRes as TornSchema<"UserMoneyResponse">).money;

    if (!money) {
      throw new Error("Failed to extract money object from response");
    }

    let withdrawableCorporateCash = 0;

    if (money.company > 0) {
      try {
        // 2. Fetch the latest company details dynamically from the API
        const rawRes = await tornApi.get("/company", {
          apiKey,
          queryParams: {
            selections: ["profile", "employees"],
          },
        });

        const res = rawRes as TornSchema<"CompanyProfileResponseMixed"> &
          TornSchema<"CompanyEmployeesResponse">;

        const profile = res.profile as
          | TornSchema<"CompanyProfileExtended">
          | undefined;
        const employees = res.employees as
          | TornSchema<"CompanyEmployeeFull">[]
          | undefined;

        if (profile && employees) {
          const dailyAdCost = profile.advertisement_budget || 0;
          let employeesWage = 0;
          for (const employee of employees) {
            employeesWage += employee.wage || 0;
          }
          const weeklyBurn = (employeesWage + dailyAdCost) * 7;
          withdrawableCorporateCash = Math.max(0, money.company - weeklyBurn);
        } else {
          withdrawableCorporateCash = money.company;
        }
      } catch (error) {
        // Fallback: If API throws (e.g. not a director or company error)
        withdrawableCorporateCash = money.company;
        logger.error(
          "Failed to calculate withdrawable corporate cash, defaulting to company bank balance",
          error,
        );
      }
    }

    // 3. Calculate Total Liquidity
    const totalLiquidity =
      money.wallet +
      money.vault +
      (money.faction?.money || 0) +
      withdrawableCorporateCash;

    // 4. Upsert into CashHistory (Chronological Snapshot)
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const startOfDayUtc = Math.floor(now.getTime() / 1000);

    const snapshotDoc = {
      id: startOfDayUtc.toString(),
      timestamp: startOfDayUtc,
      liquid_cash: totalLiquidity,
    };

    CashHistory.update(snapshotDoc);

    finishSync();
  } catch (error) {
    logger.error("Failed to run liquid cash engine:", error);
    throw error;
  }
}

export function startLiquidCashEngineWorker(): void {
  let schedule = WorkerSchedules.findOne(WORKER_NAME);

  if (!schedule) {
    WorkerSchedules.insertOne({
      id: WORKER_NAME,
      enabled: true,
      cadence_seconds: CADENCE_SECONDS,
      next_run_at: Date.now(),
      last_run_at: null,
      force_run: false,
    });
  } else if (schedule.next_run_at <= Date.now()) {
    // If it's behind schedule, run it immediately
    schedule.next_run_at = Date.now();
    WorkerSchedules.update(schedule);
  }

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: CADENCE_SECONDS,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: executeLiquidCashEngine,
      });
    },
  });
}
