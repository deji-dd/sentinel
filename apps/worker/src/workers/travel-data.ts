import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  upsertTravelData,
  type TravelData,
} from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";
import { logError, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { dateToIsoOrNull, epochSecondsToDate } from "../lib/time.js";

const WORKER_NAME = "travel_data_worker";

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
 * Updates sentinel_travel_data table on a fixed cadence (30s default).
 *
 * Logic:
 * - Fetches travel status and capacity for all users
 * - Updates travel destination, method, times, capacity
 */
async function syncTravelDataHandler(): Promise<void> {
  const users = await getAllUsers();

  if (users.length === 0) {
    return;
  }

  const travelUpdates: Array<TravelData> = [];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const user of users) {
    try {
      const apiKey = decrypt(user.api_key);

      // Fetch travel status and perks (v1 API)
      const [travelResponse, perksResponse] = await Promise.all([
        tornApi.get("/user/travel", { apiKey }),
        tornApi.getRaw<{
          property_perks?: string[];
          stock_perks?: string[];
          book_perks?: string[];
          education_perks?: string[];
          enhancer_perks?: string[];
          faction_perks?: string[];
          job_perks?: string[];
          merit_perks?: string[];
        }>("/user/", apiKey, { selections: "perks" }),
      ]);

      const travel = travelResponse.travel;
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ userId: user.user_id, error: errorMessage });
      logError(WORKER_NAME, `${user.user_id}: ${errorMessage}`);
    }
  }

  if (travelUpdates.length > 0) {
    await upsertTravelData(travelUpdates);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length}/${users.length} users failed`);
  }
}

/**
 * Start travel data worker with DB-driven scheduling.
 * Default cadence is 30s (configured in DB).
 */
export function startTravelDataWorker(): void {
  startDbScheduledRunner({
    worker: "travel_data_worker",
    defaultCadenceSeconds: 30,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncTravelDataHandler,
      });
    },
  });
}
