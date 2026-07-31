import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { tornApiManager, getPersonalKey } from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "personal_reference_sync";
const logger = new Logger(WORKER_NAME);

export type GymPerkModifiers = {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
};

export type BoosterPerkModifiers = {
  energyDrink: number;
};

export type TravelPerkModifiers = {
  hasAirstrip: boolean;
  hasWltBenefit: boolean;
  hasBookPerk: boolean;
  factionTravelReduction: number;
  totalTravelReduction: number;
};

export type DestinationTravelData = {
  id: number;
  countryCode: string;
  name: string;
  cityName: string;
  standardCost: number;
  standardSeconds: number;
};

export const DESTINATION_TRAVEL_INFO: Record<number, DestinationTravelData> = {
  1: { id: 1, countryCode: "mex", name: "Mexico", cityName: "Ciudad Juárez", standardCost: 6500, standardSeconds: 1440 },
  2: { id: 2, countryCode: "cay", name: "Cayman Islands", cityName: "George Town", standardCost: 10000, standardSeconds: 1980 },
  3: { id: 3, countryCode: "can", name: "Canada", cityName: "Toronto", standardCost: 9000, standardSeconds: 2340 },
  4: { id: 4, countryCode: "haw", name: "Hawaii", cityName: "Honolulu", standardCost: 11000, standardSeconds: 7620 },
  5: { id: 5, countryCode: "uk", name: "United Kingdom", cityName: "London", standardCost: 18000, standardSeconds: 9060 },
  6: { id: 6, countryCode: "arg", name: "Argentina", cityName: "Buenos Aires", standardCost: 21000, standardSeconds: 9480 },
  7: { id: 7, countryCode: "swi", name: "Switzerland", cityName: "Zurich", standardCost: 27000, standardSeconds: 9960 },
  8: { id: 8, countryCode: "jap", name: "Japan", cityName: "Tokyo", standardCost: 32000, standardSeconds: 12780 },
  9: { id: 9, countryCode: "chi", name: "China", cityName: "Beijing", standardCost: 35000, standardSeconds: 13740 },
  10: { id: 10, countryCode: "uae", name: "UAE", cityName: "Dubai", standardCost: 32000, standardSeconds: 15420 },
  11: { id: 11, countryCode: "saf", name: "South Africa", cityName: "Johannesburg", standardCost: 40000, standardSeconds: 16920 },
};

/**
 * Dynamically parses gym gain multipliers from raw perk strings.
 */
export function parseGymPerkModifiers(perks: string[]): GymPerkModifiers {
  let strength = 1.0;
  let speed = 1.0;
  let defense = 1.0;
  let dexterity = 1.0;

  const gymRegex =
    /\+\s*(\d+(?:\.\d+)?)%\s*(strength|speed|defense|dexterity)?\s*gym gains/i;

  for (const perk of perks) {
    const match = perk.match(gymRegex);
    if (match) {
      const percent = parseFloat(match[1]);
      const multiplier = 1 + percent / 100;
      const stat = match[2]?.toLowerCase();

      if (stat === "strength") strength *= multiplier;
      else if (stat === "speed") speed *= multiplier;
      else if (stat === "defense") defense *= multiplier;
      else if (stat === "dexterity") dexterity *= multiplier;
      else {
        strength *= multiplier;
        speed *= multiplier;
        defense *= multiplier;
        dexterity *= multiplier;
      }
    }
  }

  return { strength, speed, defense, dexterity };
}

/**
 * Dynamically parses booster gain multipliers (e.g. energy drinks) from raw perk strings.
 */
export function parseBoosterPerkModifiers(
  perks: string[],
): BoosterPerkModifiers {
  let energyDrink = 1.0;
  const drinkRegex = /\+\s*(\d+(?:\.\d+)?)%\s*energy gain from energy drinks/i;

  for (const perk of perks) {
    const match = perk.match(drinkRegex);
    if (match) {
      energyDrink += parseFloat(match[1]) / 100;
    }
  }

  return { energyDrink };
}

/**
 * Dynamically parses travel perk modifiers (Airstrip, WLT, Book, Faction Excursion) from raw perk strings.
 */
export function parseTravelPerkModifiers(perks: string[]): TravelPerkModifiers {
  let factionTravelReduction = 0;
  let hasAirstrip = false;
  let hasWltBenefit = false;
  let hasBookPerk = false;

  const travelTimeRegex = /-(\d+(?:\.\d+)?)%\s*travel\s*time/i;

  for (const perk of perks) {
    const lower = perk.toLowerCase();
    if (lower.includes("airstrip")) {
      hasAirstrip = true;
    }
    if (lower.includes("wlt") || lower.includes("westside")) {
      hasWltBenefit = true;
    }
    if (lower.includes("mailing yourself abroad")) {
      hasBookPerk = true;
      continue;
    }

    const match = perk.match(travelTimeRegex);
    if (match) {
      const pct = parseFloat(match[1]) / 100;
      factionTravelReduction += pct;
    }
  }

  const totalTravelReduction = factionTravelReduction + (hasBookPerk ? 0.25 : 0);

  return {
    hasAirstrip,
    hasWltBenefit,
    hasBookPerk,
    factionTravelReduction,
    totalTravelReduction,
  };
}

/**
 * Calculates estimated flight time in seconds given travel method & perk modifiers.
 */
export function calculateTravelTimeSeconds(
  destinationId: number,
  method: "standard" | "airstrip" | "wlt" | "business" = "airstrip",
  perks?: TravelPerkModifiers,
): number {
  const dest = DESTINATION_TRAVEL_INFO[destinationId];
  if (!dest) return 0;

  let baseMult = 1.0;
  if (method === "airstrip") baseMult = 0.7;
  else if (method === "wlt") baseMult = 0.5;
  else if (method === "business") baseMult = 0.3;

  let timeSec = dest.standardSeconds * baseMult;

  if (perks) {
    if (perks.hasBookPerk) {
      timeSec *= 0.75;
    }
    if (perks.factionTravelReduction > 0) {
      timeSec *= 1 - perks.factionTravelReduction;
    }
  }

  return Math.round(timeSec);
}

/**
 * Calculates milliseconds remaining until the next 00:15 UTC.
 */
export function getMsUntil0015Utc(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      15,
      0,
      0,
    ),
  );

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Syncs unlocked gyms and determines the best gym for each stat.
 */
export async function syncGymUnlocks(): Promise<void> {
  // Guard: skip if log_manager backfill is still in progress.
  // Gym unlock logs (5320) come from PersonalLog which won't be fully populated
  // until the backfill completes, leading to falsely low gym results.
  const backfillRecord = await db.systemState.findUnique({
    where: { id: "log_manager_backfill_progress" },
  });
  const backfillData = backfillRecord?.data as { status: string } | undefined;

  if (backfillData?.status !== "completed") {
    logger.warn(
      "Log backfill is still in progress. Skipping gym unlock sync to avoid incomplete results.",
    );
    return;
  }

  const logs = await db.personalLog.findMany({
    where: { log: 5320 },
  });

  const tornGyms = await db.tornGym.findMany();

  const unlockedGymIds = new Set<number>([1]); // Everyone has gym 1 by default
  for (const log of logs) {
    const data = log.data as any;
    if (data && typeof data.gym === "number") {
      unlockedGymIds.add(data.gym);
    }
  }

  let bestStrengthGym = 1;
  let bestDefenseGym = 1;
  let bestSpeedGym = 1;
  let bestDexterityGym = 1;

  let maxStrength = 0;
  let maxDefense = 0;
  let maxSpeed = 0;
  let maxDexterity = 0;

  for (const gymId of unlockedGymIds) {
    const gym = tornGyms.find((g) => Number(g.id) === gymId);
    if (!gym) continue;

    if (gym.strength > maxStrength) {
      maxStrength = gym.strength;
      bestStrengthGym = gymId;
    }
    if (gym.defense > maxDefense) {
      maxDefense = gym.defense;
      bestDefenseGym = gymId;
    }
    if (gym.speed > maxSpeed) {
      maxSpeed = gym.speed;
      bestSpeedGym = gymId;
    }
    if (gym.dexterity > maxDexterity) {
      maxDexterity = gym.dexterity;
      bestDexterityGym = gymId;
    }
  }

  await db.systemState.upsert({
    where: { id: "gym_unlocks" },
    update: {
      data: {
        strengthGym: bestStrengthGym,
        defenseGym: bestDefenseGym,
        speedGym: bestSpeedGym,
        dexterityGym: bestDexterityGym,
        unlockedGymIds: Array.from(unlockedGymIds),
        timestamp: Math.floor(Date.now() / 1000),
      },
      updatedAt: new Date(),
    },
    create: {
      id: "gym_unlocks",
      data: {
        strengthGym: bestStrengthGym,
        defenseGym: bestDefenseGym,
        speedGym: bestSpeedGym,
        dexterityGym: bestDexterityGym,
        unlockedGymIds: Array.from(unlockedGymIds),
        timestamp: Math.floor(Date.now() / 1000),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info(
    `Synced gym unlocks. Best gyms: Str:${bestStrengthGym}, Def:${bestDefenseGym}, Spd:${bestSpeedGym}, Dex:${bestDexterityGym}`,
  );
}

/**
 * Runs daily sync at 00:15 UTC to fetch raw user perks & gym unlocks.
 */
export async function runDailySync(): Promise<void> {
  const finishSync = logger.time();

  try {
    const keyEntry = await getPersonalKey();
    if (!keyEntry) {
      logger.warn("No personal API key found for daily sync. Skipping.");
      return;
    }

    // 1. Fetch raw perks from Torn API
    const res = (await tornApiManager.get("/user", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams: { selections: ["perks"] as any },
    })) as any;

    const categorizedPerks = {
      faction_perks: (res.faction_perks as string[]) || [],
      job_perks: (res.job_perks as string[]) || [],
      property_perks: (res.property_perks as string[]) || [],
      education_perks: (res.education_perks as string[]) || [],
      enhancer_perks: (res.enhancer_perks as string[]) || [],
      book_perks: (res.book_perks as string[]) || [],
      stock_perks: (res.stock_perks as string[]) || [],
      merit_perks: (res.merit_perks as string[]) || [],
    };

    const allPerks: string[] = Object.values(categorizedPerks).flat();
    const travelPerks = parseTravelPerkModifiers(allPerks);

    // 2. Store raw perk list, categories & parsed travel perks in PostgreSQL SystemState
    await db.systemState.upsert({
      where: { id: "user_perks" },
      update: {
        data: {
          allPerks,
          categorizedPerks,
          travelPerks,
          timestamp: Math.floor(Date.now() / 1000),
        },
        updatedAt: new Date(),
      },
      create: {
        id: "user_perks",
        data: {
          allPerks,
          categorizedPerks,
          travelPerks,
          timestamp: Math.floor(Date.now() / 1000),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(`Stored ${allPerks.length} raw user perks in PostgreSQL.`);

    // 3. Sync gym unlocks
    await syncGymUnlocks();

    finishSync();
  } catch (error) {
    logger.error("Failed to execute daily sync:", error);
  }
}

/**
 * Starts the personal reference sync worker scheduled for 00:15 UTC.
 */
export function startPersonalReferenceSync(options?: WorkerStartOptions): void {
  const initialDelayMs = options?.initialDelayMs ?? getMsUntil0015Utc();

  // Once log backfill completes, immediately run gym unlock sync so we don't
  // wait until the next 00:15 UTC cycle for accurate gym data.
  workerEvents.on("log_backfill_completed", () => {
    syncGymUnlocks().catch((err) =>
      logger.error("Error running gym unlock sync after backfill:", err),
    );
  });

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400, // 24 hours
    initialDelayMs,
    handler: runDailySync,
  });
}
