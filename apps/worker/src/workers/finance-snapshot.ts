import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const WORKER_NAME = "finance_snapshot_worker";
const SNAPSHOT_CADENCE_SECONDS = 30; // Take snapshot every 30 seconds
const PRUNE_CADENCE_SECONDS = 3600; // Prune old snapshots every hour

interface CompanyEmployee {
  wage: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface CompanyEmployees {
  [playerId: string]: CompanyEmployee;
}

interface V1CompanyResponse {
  company_detailed?: {
    company_funds?: number;
    advertising_budget?: number;
  };
  company_employees?: CompanyEmployees;
}

/**
 * Calculate liquid cash available (cash on hand + company funds + bookie value minus locked amounts)
 */
function calculateLiquidCash(
  wallet: number,
  companyFunds: number,
  bookieValue: number,
  advertisingBudget: number,
  employees: CompanyEmployees,
): number {
  let lockedFunds = 0;

  // Lock 7 days of advertising budget
  lockedFunds += advertisingBudget * 7;

  // Lock 7 days of employee wages
  for (const employeeId in employees) {
    const employee = employees[employeeId];
    if (employee && typeof employee.wage === "number") {
      lockedFunds += employee.wage * 7;
    }
  }

  const availableCompanyFunds = Math.max(0, companyFunds - lockedFunds);
  return wallet + availableCompanyFunds + bookieValue;
}

/**
 * Take a financial snapshot of the user's current state
 */
async function takeSnapshot(): Promise<void> {
  const apiKey = getPersonalApiKey();

  try {
    // Fetch all data in parallel
    // Note: V2 /user endpoint with selections replaces v1 endpoint
    // Networth has a hard 1-hour global cache that cannot be bypassed
    const [
      moneyResponse,
      networthResponse,
      personalStatsResponse,
      companyResponse,
    ] = await Promise.all([
      tornApi.get("/user/money", { apiKey }),
      tornApi.get("/user", {
        apiKey,
        queryParams: { selections: ["networth"] },
      }),
      tornApi.get("/user", {
        apiKey,
        queryParams: { selections: ["personalstats"] },
      }),
      tornApi.getRaw<V1CompanyResponse>("/company", apiKey, {
        selections: "detailed,employees",
      }),
    ]);

    // Extract money data
    const wallet = moneyResponse.money.wallet || 0;
    const netWorth = moneyResponse.money.daily_networth || 0;

    // Extract bookie value and timestamp from v2 response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const networthData = (networthResponse as any).networth;
    const bookieValue = networthData?.bookie || 0;
    const bookieTimestamp = networthData?.timestamp || 0;
    const bookieUpdatedAt = bookieTimestamp
      ? new Date(bookieTimestamp * 1000).toISOString()
      : null;

    // Extract stats from v2 response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const personalStats = (personalStatsResponse as any).personalstats || {};
    const strength = personalStats.strength || 0;
    const speed = personalStats.speed || 0;
    const defense = personalStats.defense || 0;
    const dexterity = personalStats.dexterity || 0;
    const statsTotal = personalStats.totalstats || 0;

    // Calculate liquid cash
    const companyFunds = companyResponse.company_detailed?.company_funds || 0;
    const advertisingBudget =
      companyResponse.company_detailed?.advertising_budget || 0;
    const employees = companyResponse.company_employees || {};

    const liquidCash = calculateLiquidCash(
      wallet,
      companyFunds,
      bookieValue,
      advertisingBudget,
      employees,
    );

    // Insert snapshot
    const { error } = await supabase.from(TABLE_NAMES.USER_SNAPSHOTS).insert({
      liquid_cash: liquidCash,
      bookie_value: bookieValue,
      bookie_updated_at: bookieUpdatedAt,
      net_worth: netWorth,
      stats_total: statsTotal,
      strength,
      speed,
      defense,
      dexterity,
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Snapshot failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Prune old snapshots according to strategy:
 * - Delete 30s snapshots older than 1 week
 * - Keep hourly snapshots forever
 */
async function pruneSnapshots(): Promise<void> {
  try {
    const oneWeekAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Strategy: Keep only the first snapshot of each hour after 1 week
    // This is complex to implement in a single query, so we'll use a different approach:
    // 1. Delete all snapshots older than 1 week that are NOT on the hour
    // 2. This keeps hourly snapshots (created_at minute/second = 0) while removing the 30s cadence ones

    // For simplicity, we'll delete all snapshots older than 1 week where the minute is not :00 or :30
    // Actually, let's be smarter: keep one snapshot per hour (the first one in each hour)

    // Get all snapshots older than 1 week
    const { data: oldSnapshots, error: fetchError } = await supabase
      .from(TABLE_NAMES.USER_SNAPSHOTS)
      .select("id, created_at")
      .lt("created_at", oneWeekAgo)
      .order("created_at", { ascending: true });

    if (fetchError) {
      throw fetchError;
    }

    if (!oldSnapshots || oldSnapshots.length === 0) {
      return;
    }

    // Group by hour and keep only the first snapshot of each hour
    const snapshotsToKeep = new Set<string>();
    const seenHours = new Set<string>();

    for (const snapshot of oldSnapshots) {
      const date = new Date(snapshot.created_at);
      const hourKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;

      if (!seenHours.has(hourKey)) {
        seenHours.add(hourKey);
        snapshotsToKeep.add(snapshot.id);
      }
    }

    // Delete snapshots not in the keep set
    const idsToDelete = oldSnapshots
      .filter((s) => !snapshotsToKeep.has(s.id))
      .map((s) => s.id);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from(TABLE_NAMES.USER_SNAPSHOTS)
        .delete()
        .in("id", idsToDelete);

      if (deleteError) {
        throw deleteError;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError("finance_pruning_worker", `Pruning failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Start the finance snapshot worker (takes snapshots every 30s)
 */
export function startFinanceSnapshotWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: SNAPSHOT_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 60000, // 1 minute
        handler: takeSnapshot,
      });
    },
  });
}

/**
 * Start the finance pruning worker (prunes old snapshots every hour)
 */
export function startFinancePruningWorker(): void {
  startDbScheduledRunner({
    worker: "finance_pruning_worker",
    defaultCadenceSeconds: PRUNE_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: "finance_pruning_worker",
        timeout: 120000, // 2 minutes
        handler: pruneSnapshots,
      });
    },
  });
}
