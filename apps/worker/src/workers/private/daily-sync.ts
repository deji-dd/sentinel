import {
  Logger,
  PersonalLogs,
  getWorkerApiKey,
  tornApi,
} from "@sentinel/shared";
import { UserState, TornGyms } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

const WORKER_NAME = "daily_sync";
// Run every day
const CADENCE_SEC = 60 * 60 * 24;

export async function runDailySync() {
  const logger = new Logger(WORKER_NAME);

  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: "perks,bars" },
    });

    const perksLists = [
      ...(res.faction_perks || []),
      ...(res.job_perks || []),
      ...(res.property_perks || []),
      ...(res.education_perks || []),
      ...(res.enhancer_perks || []),
      ...(res.book_perks || []),
      ...(res.stock_perks || []),
      ...(res.merit_perks || []),
    ];

    let strength_gain_modifier = 1.0;
    let speed_gain_modifier = 1.0;
    let defense_gain_modifier = 1.0;
    let dexterity_gain_modifier = 1.0;

    let energy_drink_modifier = 1.0;

    const regex =
      /\+\s*(\d+(?:\.\d+)?)%\s*(strength|speed|defense|dexterity)?\s*gym gains/i;

    for (const perk of perksLists) {
      const match = perk.match(regex);
      if (match) {
        const percent = parseFloat(match[1]);
        const multiplier = 1 + percent / 100;
        const stat = match[2]?.toLowerCase();

        if (stat === "strength") strength_gain_modifier *= multiplier;
        else if (stat === "speed") speed_gain_modifier *= multiplier;
        else if (stat === "defense") defense_gain_modifier *= multiplier;
        else if (stat === "dexterity") dexterity_gain_modifier *= multiplier;
        else {
          // General gym gains
          strength_gain_modifier *= multiplier;
          speed_gain_modifier *= multiplier;
          defense_gain_modifier *= multiplier;
          dexterity_gain_modifier *= multiplier;
        }
      }

      const drinkMatch = perk.match(
        /\+\s*(\d+(?:\.\d+)?)%\s*energy gain from energy drinks/i,
      );
      if (drinkMatch) {
        energy_drink_modifier += parseFloat(drinkMatch[1]) / 100;
      }
    }

    UserState.insertOne({
      id: "gym_perks",
      strength_gain_modifier,
      speed_gain_modifier,
      defense_gain_modifier,
      dexterity_gain_modifier,
      timestamp: Math.floor(Date.now() / 1000),
    });

    UserState.insertOne({
      id: "booster_perks",
      energy_drink_modifier,
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (res.bars) {
      UserState.insertOne({
        id: "bars",
        energy_maximum: res.bars.energy.maximum,
        happy_maximum: res.bars.happy.maximum,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }

    await syncGymUnlocks(apiKey);

    finishSync();
  } catch (error) {
    logger.error("Failed to execute daily sync", error);
  }
}

export async function syncGymUnlocks(apiKey: string) {
  let logs = PersonalLogs.findAll((l) => l.details?.id === 5320);
  const existingGymState = UserState.findOne("gym_unlocks");

  // Guard: Only hit the API if we have no local logs AND we haven't built the state yet
  if (logs.length === 0 && !existingGymState) {
    const logRes = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { log: [5320] },
    });
    if (logRes.log) {
      logs = logRes.log;
    }
  }

  const gyms = TornGyms.findAll();

  if (logs.length > 0 && gyms.length > 0) {
    // Find all gym IDs unlocked. (Add 1 by default since everyone has the first gym)
    const unlockedGymIds = new Set<number>([1]);
    for (const log of logs) {
      if (log.data && typeof log.data.gym === "number") {
        unlockedGymIds.add(log.data.gym);
      }
    }

    let bestStrengthGym = 0;
    let bestDefenseGym = 0;
    let bestSpeedGym = 0;
    let bestDexterityGym = 0;

    let maxStrength = 0;
    let maxDefense = 0;
    let maxSpeed = 0;
    let maxDexterity = 0;

    for (const gymId of unlockedGymIds) {
      const gym = TornGyms.findOne(String(gymId));
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

    UserState.insertOne({
      id: "gym_unlocks",
      strength_gym: bestStrengthGym,
      defense_gym: bestDefenseGym,
      speed_gym: bestSpeedGym,
      dexterity_gym: bestDexterityGym,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}

export function startDailySync() {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: runDailySync,
    defaultCadenceSeconds: CADENCE_SEC,
  });
}
