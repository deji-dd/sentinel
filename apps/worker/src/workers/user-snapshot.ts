import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";

const SNAPSHOT_WORKER_NAME = "user_snapshot_worker";
const PRUNING_WORKER_NAME = "user_snapshot_pruning_worker";
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

type NetworthSelectionResponse = {
  networth?: { bookie?: number; timestamp?: number };
};
type PersonalStatsSelectionResponse = {
  personalstats?: Record<string, number>;
};
type GymSelectionResponse = {
  gym?: { id?: number };
};

function hasNetworth(response: unknown): response is NetworthSelectionResponse {
  return !!response && typeof response === "object" && "networth" in response;
}

function hasPersonalStats(
  response: unknown,
): response is PersonalStatsSelectionResponse {
  return (
    !!response && typeof response === "object" && "personalstats" in response
  );
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
 * Take a snapshot of the user's current state (financial, stats, and training)
 */
async function takeSnapshot(): Promise<void> {
  const apiKey = getPersonalApiKey();
  const startTime = Date.now();

  try {
    // Fetch all data in parallel
    // Note: Networth (bookie) available via v2 /user selections, still has 1-hour cache
    // Personalstats available in v2, gym from basic /user endpoint
    const [
      moneyResponse,
      networthResponse,
      personalStatsResponse,
      userResponse,
      companyResponse,
    ] = await Promise.all([
      tornApi.get("/user/money", { apiKey }),
      // v2 - networth with bookie value (1-hour cache)
      tornApi.get("/user", {
        apiKey,
        queryParams: { selections: ["networth"] },
      }),
      // v2 - personalstats for training stats
      tornApi.get("/user", {
        apiKey,
        queryParams: { selections: ["personalstats"], cat: "all" },
      }),
      // v2 - gym selection from user endpoint
      tornApi.get("/user", {
        apiKey,
        queryParams: { selections: ["gym"] },
      }),
      // v1 only - company endpoint
      tornApi.getRaw<V1CompanyResponse>("/company", apiKey, {
        selections: "detailed,employees",
      }),
    ]);

    // Extract money data
    const wallet = moneyResponse.money.wallet || 0;
    const netWorth = moneyResponse.money.daily_networth || 0;

    // Extract bookie value and timestamp from v2 networth response
    const networthData = hasNetworth(networthResponse)
      ? networthResponse.networth
      : undefined;
    const bookieValue = networthData?.bookie || 0;
    const bookieTimestamp = networthData?.timestamp || 0;
    const bookieUpdatedAt = bookieTimestamp
      ? new Date(bookieTimestamp * 1000).toISOString()
      : null;

    // Extract stats from v2 personalstats response
    const personalStats = hasPersonalStats(personalStatsResponse)
      ? personalStatsResponse.personalstats || {}
      : {};
    const strength = personalStats.strength || 0;
    const speed = personalStats.speed || 0;
    const defense = personalStats.defense || 0;
    const dexterity = personalStats.dexterity || 0;
    const statsTotal = personalStats.totalstats || 0;

    // Extract gym from v2 gym selection response
    const gymData = (userResponse as GymSelectionResponse).gym || {};
    const activeGym = gymData.id || null;

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
      active_gym: activeGym,
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    let errorMessage = "Unknown error";
    if (typeof error === "object" && error !== null && "message" in error) {
      errorMessage = (error as { message: string }).message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    const duration =
      elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(2)}s`;
    logError(
      SNAPSHOT_WORKER_NAME,
      `Sync failed: ${errorMessage} (${duration})`,
    );
    throw error;
  }
}

/**
 * Prune old snapshots according to strategy:
 * - Delete 30s snapshots older than 1 week
 * - Keep hourly snapshots forever
 */
async function pruneSnapshots(): Promise<void> {
  const startTime = Date.now();
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
    const elapsed = Date.now() - startTime;
    let errorMessage = "Unknown error";
    if (typeof error === "object" && error !== null && "message" in error) {
      errorMessage = (error as { message: string }).message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    const duration =
      elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(2)}s`;
    logError(PRUNING_WORKER_NAME, `Sync failed: ${errorMessage} (${duration})`);
    throw error;
  }
}

/**
 * Start the user snapshot worker (takes snapshots every 30s)
 */
export function startUserSnapshotWorker(): void {
  startDbScheduledRunner({
    worker: SNAPSHOT_WORKER_NAME,
    defaultCadenceSeconds: SNAPSHOT_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: SNAPSHOT_WORKER_NAME,
        timeout: 60000, // 1 minute
        handler: takeSnapshot,
      });
    },
  });
}

/**
 * Start the user snapshot pruning worker (prunes old snapshots every hour)
 */
export function startUserSnapshotPruningWorker(): void {
  startDbScheduledRunner({
    worker: PRUNING_WORKER_NAME,
    defaultCadenceSeconds: PRUNE_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: PRUNING_WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: pruneSnapshots,
      });
    },
  });
}
