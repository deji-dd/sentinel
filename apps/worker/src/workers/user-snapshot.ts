import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { logDuration, logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

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

interface PerkGains {
  strength: number;
  speed: number;
  dexterity: number;
  defense: number;
}

/**
 * Parse gym perk multipliers from perks response
 * Perks are multiplicative, not additive. Each percentage is converted to a multiplier (1 + percentage/100)
 * and multiplied together across all perk sources.
 * Example: +2% * +15% * +1% = 1.02 * 1.15 * 1.01 = 1.1773 multiplier
 * Searches all perk categories for gym gain entries.
 * Expected formats: "+ 15% strength gym gains", "+ 2% gym gains", "+ 1% strength gym gains"
 */
function parseGymPerkGains(perks: Record<string, unknown>): PerkGains {
  const multipliers: PerkGains = {
    strength: 1,
    speed: 1,
    dexterity: 1,
    defense: 1,
  };

  if (!perks || typeof perks !== "object") {
    return multipliers;
  }

  // Iterate through all perk categories
  for (const perkCategory of Object.values(perks)) {
    // Each category is an array of perk strings
    if (!Array.isArray(perkCategory)) continue;

    for (const perkValue of perkCategory) {
      if (typeof perkValue !== "string") continue;

      // Parse specific stat gym gains (e.g., "+ 15% strength gym gains")
      const strengthMatch = perkValue.match(
        /\+\s*(\d+(?:\.\d+)?)\s*%\s*strength\s+gym\s+gains/i,
      );
      if (strengthMatch) {
        const percentage = parseFloat(strengthMatch[1]);
        multipliers.strength *= 1 + percentage / 100;
      }

      const speedMatch = perkValue.match(
        /\+\s*(\d+(?:\.\d+)?)\s*%\s*speed\s+gym\s+gains/i,
      );
      if (speedMatch) {
        const percentage = parseFloat(speedMatch[1]);
        multipliers.speed *= 1 + percentage / 100;
      }

      const dexterityMatch = perkValue.match(
        /\+\s*(\d+(?:\.\d+)?)\s*%\s*dexterity\s+gym\s+gains/i,
      );
      if (dexterityMatch) {
        const percentage = parseFloat(dexterityMatch[1]);
        multipliers.dexterity *= 1 + percentage / 100;
      }

      const defenseMatch = perkValue.match(
        /\+\s*(\d+(?:\.\d+)?)\s*%\s*defense\s+gym\s+gains/i,
      );
      if (defenseMatch) {
        const percentage = parseFloat(defenseMatch[1]);
        multipliers.defense *= 1 + percentage / 100;
      }

      // Parse general gym gains (e.g., "+ 2% gym gains") - applies to all stats
      const generalMatch = perkValue.match(
        /\+\s*(\d+(?:\.\d+)?)\s*%\s*gym\s+gains(?!\s+\w+)/i,
      );
      if (generalMatch) {
        const percentage = parseFloat(generalMatch[1]);
        const multiplier = 1 + percentage / 100;
        multipliers.strength *= multiplier;
        multipliers.speed *= multiplier;
        multipliers.dexterity *= multiplier;
        multipliers.defense *= multiplier;
      }
    }
  }

  return multipliers;
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
 * Take a snapshot of the user's current state (financial, stats, training, bars, and cooldowns)
 */
async function takeSnapshot(): Promise<void> {
  const apiKey = getPersonalApiKey();
  const startTime = Date.now();

  try {
    // Fetch all data in parallel
    const [userResponse, companyResponse] = await Promise.all([
      // v2 - combined user selections (money, networth, personalstats, gym, bars, cooldowns, perks)
      tornApi.get("/user", {
        apiKey,
        queryParams: {
          selections: [
            "money",
            "networth",
            "personalstats",
            "gym",
            "bars",
            "cooldowns",
            "perks",
          ],
          cat: "all",
        },
      }),
      // v1 only - company endpoint
      tornApi.getRaw<V1CompanyResponse>("/company", apiKey, {
        selections: "detailed,employees",
      }),
    ]);

    // Extract money data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const money = (userResponse as any).money;
    if (!money) {
      throw new Error("Missing money in Torn response");
    }
    const wallet = money.wallet || 0;
    const netWorth = money.daily_networth || 0;

    // Extract bookie value and timestamp from v2 networth selection
    const networthData = hasNetworth(userResponse)
      ? userResponse.networth
      : undefined;
    const bookieValue = networthData?.bookie || 0;
    const bookieTimestamp = networthData?.timestamp || 0;
    const bookieUpdatedAt = bookieTimestamp
      ? new Date(bookieTimestamp * 1000).toISOString()
      : null;

    // Extract stats from v2 personalstats selection
    const personalStats = hasPersonalStats(userResponse)
      ? userResponse.personalstats || {}
      : {};
    const strength = personalStats.strength || 0;
    const speed = personalStats.speed || 0;
    const defense = personalStats.defense || 0;
    const dexterity = personalStats.dexterity || 0;
    const statsTotal = personalStats.totalstats || 0;

    // Extract gym from v2 gym selection
    const gymData = (userResponse as GymSelectionResponse).gym || {};
    const activeGym = gymData.id || null;

    // Extract bars data from user response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars = (userResponse as any).bars;
    if (!bars) {
      throw new Error("Missing bars in Torn response");
    }
    const energyCurrent = bars.energy?.current || 0;
    const energyMaximum = bars.energy?.maximum || 0;
    const nerveCurrent = bars.nerve?.current || 0;
    const nerveMaximum = bars.nerve?.maximum || 0;
    const happyCurrent = bars.happy?.current || 0;
    const happyMaximum = bars.happy?.maximum || 0;
    const lifeCurrent = bars.life?.current || 0;
    const lifeMaximum = bars.life?.maximum || 0;
    const chainCurrent = bars.chain?.current || 0;
    const chainMaximum = bars.chain?.max || 0;

    // Calculate time to full for energy and nerve
    const energySecondsPerPoint = energyMaximum === 150 ? 120 : 180;
    const nerveSecondsPerPoint = 300;
    const energyFlatTimeToFull = energyMaximum * energySecondsPerPoint;
    const nerveFlatTimeToFull = nerveMaximum * nerveSecondsPerPoint;
    const energyTimeToFull =
      (energyMaximum - energyCurrent) * energySecondsPerPoint;
    const nerveTimeToFull =
      (nerveMaximum - nerveCurrent) * nerveSecondsPerPoint;

    // Extract cooldowns data from user response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cooldowns = (userResponse as any).cooldowns;
    if (!cooldowns) {
      throw new Error("Missing cooldowns in Torn response");
    }
    const drugCooldown = cooldowns.drug || 0;
    const medicalCooldown = cooldowns.medical || 0;
    const boosterCooldown = cooldowns.booster || 0;

    // Extract and parse perk gains from user response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perks = (userResponse as any).perks || {};
    const perkGains = parseGymPerkGains(perks);

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
      energy_current: energyCurrent,
      energy_maximum: energyMaximum,
      nerve_current: nerveCurrent,
      nerve_maximum: nerveMaximum,
      happy_current: happyCurrent,
      happy_maximum: happyMaximum,
      life_current: lifeCurrent,
      life_maximum: lifeMaximum,
      chain_current: chainCurrent,
      chain_maximum: chainMaximum,
      energy_flat_time_to_full: energyFlatTimeToFull,
      energy_time_to_full: energyTimeToFull,
      nerve_flat_time_to_full: nerveFlatTimeToFull,
      nerve_time_to_full: nerveTimeToFull,
      drug_cooldown: drugCooldown,
      medical_cooldown: medicalCooldown,
      booster_cooldown: boosterCooldown,
      strength_perk_gains: perkGains.strength,
      speed_perk_gains: perkGains.speed,
      dexterity_perk_gains: perkGains.dexterity,
      defense_perk_gains: perkGains.defense,
    });

    if (error) {
      throw error;
    }

    const duration = Date.now() - startTime;
    logDuration(SNAPSHOT_WORKER_NAME, "Sync completed", duration);
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

      const duration = Date.now() - startTime;
      logDuration(
        PRUNING_WORKER_NAME,
        `Sync completed (deleted ${idsToDelete.length} old snapshots)`,
        duration,
      );
    } else {
      const duration = Date.now() - startTime;
      logDuration(
        PRUNING_WORKER_NAME,
        "Sync completed (no snapshots to delete)",
        duration,
      );
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
