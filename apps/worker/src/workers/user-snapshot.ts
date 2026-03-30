import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { logDuration, logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

const SNAPSHOT_WORKER_NAME = "user_snapshot_worker";
const PRUNING_WORKER_NAME = "user_snapshot_pruning_worker";
const SNAPSHOT_CADENCE_SECONDS = 30; // Take snapshot every 30 seconds
const PRUNE_CADENCE_SECONDS = 3600; // Prune old snapshots every hour
const SNAPSHOT_PRUNE_BATCH_SIZE = 5000;

interface CompanyEmployee {
  wage: number;
  [key: string]: unknown;
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
type GymSelectionResponse = {
  gym?: { id?: number };
};

type UserSnapshotSelectionsResponse = NetworthSelectionResponse &
  GymSelectionResponse & {
    money?: {
      wallet?: number;
      daily_networth?: number;
    };
    bars?: {
      energy?: { current?: number; maximum?: number };
      nerve?: { current?: number; maximum?: number };
      happy?: { current?: number; maximum?: number };
      life?: { current?: number; maximum?: number };
      chain?: { current?: number; max?: number };
    };
    cooldowns?: {
      drug?: number;
      medical?: number;
      booster?: number;
    };
  };

type SnapshotRow = {
  id: string;
  created_at: string;
};

function hasNetworth(response: unknown): response is NetworthSelectionResponse {
  return !!response && typeof response === "object" && "networth" in response;
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
  const apiKey = await getSystemApiKey("personal");
  const startTime = Date.now();

  try {
    // Fetch all data in parallel
    const [userResponse, companyResponse] = await Promise.all([
      // v2 - combined user selections (money, networth, personalstats, gym, bars, cooldowns, perks)
      tornApi.get("/user", {
        apiKey,
        queryParams: {
          selections: ["money", "networth", "gym", "bars", "cooldowns"],
          cat: "all",
        },
      }),
      // v1 only - company endpoint
      tornApi.getRaw<V1CompanyResponse>("/company", apiKey, {
        selections: "detailed,employees",
      }),
    ]);

    const userData = userResponse as UserSnapshotSelectionsResponse;

    // Extract money data
    const money = userData.money;
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

    // Extract gym from v2 gym selection
    const gymData = userData.gym || {};
    const activeGym = gymData.id || null;

    // Extract bars data from user response
    const bars = userData.bars;
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
    const cooldowns = userData.cooldowns;
    if (!cooldowns) {
      throw new Error("Missing cooldowns in Torn response");
    }
    const drugCooldown = cooldowns.drug || 0;
    const medicalCooldown = cooldowns.medical || 0;
    const boosterCooldown = cooldowns.booster || 0;

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

    const db = getKysely();
    await db
      .insertInto(TABLE_NAMES.USER_SNAPSHOTS)
      .values({
        id: randomUUID(),
        liquid_cash: liquidCash,
        bookie_value: bookieValue,
        bookie_updated_at: bookieUpdatedAt,
        net_worth: netWorth,
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
      })
      .execute();

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
      `Sync failed: ${errorMessage} (${new Date().toISOString()}) (${duration})`,
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

    const db = getKysely();
    // Stream old snapshots in ascending order and only keep the first snapshot per hour.
    // Cursor-based batching prevents large memory spikes as this table grows.
    const snapshotsToKeep = new Set<string>();
    const seenHours = new Set<string>();
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    let deletedCount = 0;

    while (true) {
      let query = db
        .selectFrom(TABLE_NAMES.USER_SNAPSHOTS)
        .select(["id", "created_at"])
        .where("created_at", "<", oneWeekAgo);

      if (cursorCreatedAt && cursorId) {
        query = query.where((eb) =>
          eb.or([
            eb("created_at", ">", cursorCreatedAt),
            eb.and([
              eb("created_at", "=", cursorCreatedAt),
              eb("id", ">", cursorId),
            ]),
          ]),
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
        deletedCount += idsToDelete.length;
      }

      const lastRow = batch[batch.length - 1];
      cursorCreatedAt = lastRow.created_at;
      cursorId = lastRow.id;
    }

    const duration = Date.now() - startTime;
    if (deletedCount > 0) {
      logDuration(
        PRUNING_WORKER_NAME,
        `Sync completed (deleted ${deletedCount} old snapshots)`,
        duration,
      );
      return;
    }

    logDuration(
      PRUNING_WORKER_NAME,
      "Sync completed (no snapshots to delete)",
      duration,
    );
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
