import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertTravelData,
  type TravelData,
} from "../lib/supabase.js";
import {
  fetchTornUserBasic,
  fetchTornUserTravel,
  fetchTornUserPerks,
} from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { dateToIsoOrNull, epochSecondsToDate } from "../lib/time.js";

const WORKER_NAME = "travel-data-worker";

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function extractNumber(text: string): number | null {
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function computeCapacityFromPerks(params: {
  hasAirstrip: boolean;
  hasWltBenefit: boolean;
  enhancerPerks: string[];
  jobPerks: string[];
  factionPerks: string[];
  bookPerks: string[];
}): number {
  const {
    hasAirstrip,
    hasWltBenefit,
    enhancerPerks,
    jobPerks,
    factionPerks,
    bookPerks,
  } = params;

  let capacity = hasAirstrip || hasWltBenefit ? 15 : 5;

  let suitcaseBonus = 0;
  enhancerPerks.forEach((perk) => {
    const lower = perk.toLowerCase();
    if (!lower.includes("suitcase")) return;
    if (lower.includes("large")) {
      suitcaseBonus = Math.max(suitcaseBonus, 4);
    } else if (lower.includes("medium")) {
      suitcaseBonus = Math.max(suitcaseBonus, 3);
    } else if (lower.includes("small")) {
      suitcaseBonus = Math.max(suitcaseBonus, 2);
    } else {
      const num = extractNumber(lower);
      if (num) suitcaseBonus = Math.max(suitcaseBonus, num);
    }
  });
  capacity += suitcaseBonus;

  let jobBonus = 0;
  jobPerks.forEach((perk) => {
    const lower = perk.toLowerCase();
    if (includesAny(lower, ["lingerie"])) {
      jobBonus = Math.max(jobBonus, 2);
    }
    if (includesAny(lower, ["cruise line"])) {
      if (includesAny(lower, ["10*", "10 star", "10-star"])) {
        jobBonus = Math.max(jobBonus, 3);
      } else if (includesAny(lower, ["3*", "3 star", "3-star"])) {
        jobBonus = Math.max(jobBonus, 2);
      }
    }
    if (includesAny(lower, ["flower shop"]) && includesAny(lower, ["flower"])) {
      jobBonus = Math.max(jobBonus, 5);
    }
    if (includesAny(lower, ["toy shop"]) && includesAny(lower, ["plush"])) {
      jobBonus = Math.max(jobBonus, 5);
    }
  });
  capacity += jobBonus;

  let factionBonus = 0;
  factionPerks.forEach((perk) => {
    const lower = perk.toLowerCase();
    if (!includesAny(lower, ["excursion", "travel"])) return;
    const num = extractNumber(lower);
    if (num !== null) {
      factionBonus = Math.max(factionBonus, Math.min(num, 10));
    }
  });
  capacity += factionBonus;

  const hasSmugglingBook = bookPerks.some((perk) =>
    includesAny(perk, ["smuggling for beginners", "travel items by 10"]),
  );
  if (hasSmugglingBook) {
    capacity += 10;
  }

  capacity = Math.min(capacity, 44);

  return capacity;
}

/**
 * Travel data worker - syncs travel status and capacity from Torn API.
 * Updates sentinel_travel_data table with dynamic timing based on travel status.
 *
 * Logic:
 * - Fetches travel status and capacity for all users
 * - Updates travel destination, method, times, capacity
 * - Dynamic timing: polls more frequently when users are traveling
 */
async function syncTravelDataHandler(): Promise<void> {
  const users = await getAllUsers();
  log(WORKER_NAME, `Syncing travel data for ${users.length} users`);

  if (users.length === 0) {
    logWarn(WORKER_NAME, "No users to sync");
    return;
  }

  const travelUpdates: Array<TravelData> = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);

      // Fetch travel status, basic profile (for capacity), and perks (v1 API)
      const [travelResponse, basicResponse, perksResponse] = await Promise.all([
        fetchTornUserTravel(apiKey),
        fetchTornUserBasic(apiKey),
        fetchTornUserPerks(apiKey),
      ]);

      const travel = travelResponse.travel;
      const apiCapacity = basicResponse.profile?.capacity ?? 0;
      const propertyPerks = perksResponse.property_perks || [];
      const stockPerks = perksResponse.stock_perks || [];
      const bookPerks = perksResponse.book_perks || [];
      const enhancerPerks = perksResponse.enhancer_perks || [];
      const jobPerks = perksResponse.job_perks || [];
      const factionPerks = perksResponse.faction_perks || [];

      const hasAirstrip = propertyPerks.some((perk) =>
        perk.toLowerCase().includes("airstrip"),
      );

      const hasWltBenefit = stockPerks.some((perk) => {
        const lower = perk.toLowerCase();
        return (
          lower.includes("jet") ||
          lower.includes("wlt") ||
          lower.includes("airport")
        );
      });

      const activeTravelBook = bookPerks.some((perk) =>
        perk.toLowerCase().includes("travel time"),
      );

      const computedCapacity = computeCapacityFromPerks({
        hasAirstrip,
        hasWltBenefit,
        enhancerPerks,
        jobPerks,
        factionPerks,
        bookPerks,
      });

      const departedAt = epochSecondsToDate(travel?.departed_at ?? null);
      const arrivalAt = epochSecondsToDate(travel?.arrival_at ?? null);
      const timeLeft = travel?.time_left ?? 0;

      const update: TravelData = {
        user_id: user.user_id,
        travel_destination: travel?.destination ?? null,
        travel_method: travel?.method ?? null,
        travel_departed_at: dateToIsoOrNull(departedAt),
        travel_arrival_at: dateToIsoOrNull(arrivalAt),
        travel_time_left: timeLeft ?? null,
        capacity: computedCapacity,
        has_airstrip: hasAirstrip,
        has_wlt_benefit: hasWltBenefit,
        active_travel_book: activeTravelBook,
      };

      travelUpdates.push(update);

      log(
        WORKER_NAME,
        `User ${user.player_id}: ${travel?.destination ?? "not traveling"}, capacity=${computedCapacity}, airstrip=${hasAirstrip}, wlt=${hasWltBenefit}, book=${activeTravelBook}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `Failed for user ${user.user_id}: ${errorMessage}`);
    }
  }

  if (travelUpdates.length > 0) {
    await upsertTravelData(travelUpdates);
    logSuccess(WORKER_NAME, `Updated ${travelUpdates.length} travel records`);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} users failed to sync`);
  }
}

/**
 * Start travel data worker with DB-driven scheduling.
 * Default cadence is 30s (configured in DB).
 */
export function startTravelDataWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: "travel_data_worker",
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncTravelDataHandler,
      });
    },
  });

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncTravelDataHandler,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTravelDataWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
