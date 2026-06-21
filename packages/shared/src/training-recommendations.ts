import { Kysely } from "kysely";
import type { DB } from "./db/kysely-types.js";
import { TABLE_NAMES } from "./constants.js";
import { TornApiClient } from "./torn.js";

export interface FactionPerks {
  strength: number;
  defense: number;
  speed: number;
  dexterity: number;
}

export interface TrainingRecommendationResult {
  stat: string;
  statKey: string;
  diff: number;
  text: string;
  gymRecommendation: string | null;
  currentEnergy: number;
  maxEnergy: number;
  currentHappy: number;
  maxHappy: number;
  factionPerks: FactionPerks;
  activeGymName: string;
  buildInfo: {
    selectedBuild: string;
    ratios: {
      strength: number;
      defense: number;
      speed: number;
      dexterity: number;
    };
  };
}

export async function getPersonalTrainingRecommendations(
  db: Kysely<DB>,
  userId: string,
  apiKey?: string,
  tornApi?: TornApiClient
): Promise<TrainingRecommendationResult> {
  // 1. Fetch current battle stats from snapshots
  const stats = await db
    .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const statsData = stats
    ? {
        strength: stats.strength,
        speed: stats.speed,
        defense: stats.defense,
        dexterity: stats.dexterity,
        total_stats: stats.total_stats,
      }
    : {
        strength: 50000,
        speed: 50000,
        defense: 50000,
        dexterity: 50000,
        total_stats: 200000,
      };

  // 2. Fetch latest user snapshot (active gym, current/max happy, current/max energy, booster cooldown)
  const userSnapshot = await db
    .selectFrom(TABLE_NAMES.USER_SNAPSHOTS)
    .select(["active_gym", "happy_current", "happy_maximum", "energy_current", "energy_maximum", "booster_cooldown"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const activeGymId = userSnapshot?.active_gym;
  const currentEnergy = userSnapshot?.energy_current ? Number(userSnapshot.energy_current) : 0;
  const maxEnergy = userSnapshot?.energy_maximum ? Number(userSnapshot.energy_maximum) : 150;
  const happyCurrent = userSnapshot?.happy_current ? Number(userSnapshot.happy_current) : 0;
  const happyMaximum = userSnapshot?.happy_maximum ? Number(userSnapshot.happy_maximum) : 0;
  const boosterCooldown = userSnapshot?.booster_cooldown ? Number(userSnapshot.booster_cooldown) : 0;

  let activeGym = {
    name: "Premier Fitness",
    strength: 20,
    speed: 20,
    defense: 20,
    dexterity: 20,
  };

  if (activeGymId) {
    const gym = await db
      .selectFrom(TABLE_NAMES.TORN_GYMS)
      .selectAll()
      .where("id", "=", activeGymId)
      .executeTakeFirst();
    if (gym) {
      activeGym = {
        name: gym.name,
        strength: gym.strength,
        speed: gym.speed,
        defense: gym.defense,
        dexterity: gym.dexterity,
      };
    }
  }

  // 3. Fetch Target Ratios
  const personalSettings = await db
    .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS)
    .selectAll()
    .where("user_id", "=", String(userId))
    .executeTakeFirst();

  const build = personalSettings?.selected_build || "balanced";
  const strengthPct = personalSettings?.target_strength_ratio !== undefined ? Number(personalSettings.target_strength_ratio) : 25;
  const defensePct = personalSettings?.target_defense_ratio !== undefined ? Number(personalSettings.target_defense_ratio) : 25;
  const speedPct = personalSettings?.target_speed_ratio !== undefined ? Number(personalSettings.target_speed_ratio) : 25;
  const dexterityPct = personalSettings?.target_dexterity_ratio !== undefined ? Number(personalSettings.target_dexterity_ratio) : 25;

  const currentStr = statsData.strength;
  const currentDef = statsData.defense;
  const currentSpd = statsData.speed;
  const currentDex = statsData.dexterity;
  const totalStats = currentStr + currentDef + currentSpd + currentDex;

  const targetStr = totalStats * (strengthPct / 100);
  const targetDef = totalStats * (defensePct / 100);
  const targetSpd = totalStats * (speedPct / 100);
  const targetDex = totalStats * (dexterityPct / 100);

  const diffStr = targetStr - currentStr;
  const diffDef = targetDef - currentDef;
  const diffSpd = targetSpd - currentSpd;
  const diffDex = targetDex - currentDex;

  const formatNumber = (num: number): string => {
    const absNum = Math.abs(num);
    if (absNum >= 1_000_000_000) {
      return (num / 1_000_000_000).toFixed(1) + "B";
    }
    if (absNum >= 1_000_000) {
      return (num / 1_000_000).toFixed(1) + "M";
    }
    if (absNum >= 1_000) {
      return (num / 1_000).toFixed(1) + "K";
    }
    return Math.round(num).toLocaleString();
  };

  const statsBehind = [
    { name: "strength", label: "Strength", diff: diffStr, current: currentStr, target: targetStr },
    { name: "defense", label: "Defense", diff: diffDef, current: currentDef, target: targetDef },
    { name: "speed", label: "Speed", diff: diffSpd, current: currentSpd, target: targetSpd },
    { name: "dexterity", label: "Dexterity", diff: diffDex, current: currentDex, target: targetDex },
  ];

  const sortedBehind = [...statsBehind].sort((a, b) => b.diff - a.diff);
  const recommendedStatObj = sortedBehind[0];

  // 4. Fetch Faction Perks (Steadfast) from Torn API
  const factionPerks: FactionPerks = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
  let maxBoosterCooldownMins = 24 * 60; // default 24h
  if (apiKey) {
    try {
      const client = tornApi || new TornApiClient();
      const perksResponse = await client.getRaw<any>("/user", apiKey, {
        selections: "perks",
      });

      const rawFactionPerks = perksResponse?.faction_perks || perksResponse?.perks || [];
      const perkStrings: string[] = [];

      if (Array.isArray(rawFactionPerks)) {
        for (const p of rawFactionPerks) {
          if (typeof p === "string") {
            perkStrings.push(p);
          } else if (p && typeof p === "object" && typeof p.perk === "string") {
            const source = String(p.source || p.category || "").toLowerCase();
            if (source.includes("faction")) {
              perkStrings.push(p.perk);
            }
          }
        }
      } else if (rawFactionPerks && typeof rawFactionPerks === "object") {
        for (const val of Object.values(rawFactionPerks)) {
          if (typeof val === "string") {
            perkStrings.push(val);
          }
        }
      }

      const gymPerkRegex = /([+-]?\d+)\s*%\s*(strength|defense|speed|dexterity)\s*gym\s*gains/i;
      for (const str of perkStrings) {
        const match = str.match(gymPerkRegex);
        if (match) {
          const pct = parseInt(match[1], 10);
          const stat = match[2].toLowerCase();
          if (stat === "strength") factionPerks.strength += pct;
          else if (stat === "defense") factionPerks.defense += pct;
          else if (stat === "speed") factionPerks.speed += pct;
          else if (stat === "dexterity") factionPerks.dexterity += pct;
        }
      }

      // Check for booster cooldown limit increase perks (Toleration branch)
      // e.g. "Provides a +24h booster cooldown limit" or similar
      const boosterPerkRegex = /([+-]?\d+)\s*h(?:our)?s?\s*booster\s*cooldown\s*limit/i;
      for (const str of perkStrings) {
        const match = str.match(boosterPerkRegex);
        if (match) {
          const hours = parseInt(match[1], 10);
          if (hours > 0) {
            maxBoosterCooldownMins += hours * 60;
          }
        }
      }
    } catch (err) {
      console.error("[Training Recommendations Utility] Failed to fetch perks from Torn:", err);
    }
  }
  const maxBoosterCooldownSeconds = maxBoosterCooldownMins * 60;

  // 5. Calculate Recommendations Texts
  const recommendedStatName = recommendedStatObj.name;
  const recommendedPerk = factionPerks[recommendedStatName as keyof typeof factionPerks] || 0;
  const perkText = recommendedPerk > 0 ? ` (Steadfast: +${recommendedPerk}% gains)` : "";

  let recommendationText = "";
  if (recommendedStatObj.diff > 0) {
    const formattedDiff = formatNumber(recommendedStatObj.diff);
    recommendationText = `Your ${recommendedStatObj.label} is ${formattedDiff} behind the ratio${perkText}. Dump all available energy (${currentEnergy} E) into ${recommendedStatObj.label} today.`;
  } else {
    recommendationText = `Your stats are balanced! Train ${recommendedStatObj.label}${perkText} to maintain optimal combat ratio multiplier.`;
  }

  // 6. Query Gyms and determine switch recommendations
  const unlockedGyms = await db
    .selectFrom(TABLE_NAMES.TORN_GYMS)
    .selectAll()
    .where("unlocked", "=", 1)
    .execute();

  const currentActiveGym = unlockedGyms.find((g) => g.id === activeGymId);

  let bestGymForStat = unlockedGyms[0];
  for (const gym of unlockedGyms) {
    const val = Number(gym[recommendedStatName as keyof typeof gym] || 0);
    const bestVal = Number(bestGymForStat[recommendedStatName as keyof typeof bestGymForStat] || 0);
    if (val > bestVal) {
      bestGymForStat = gym;
    }
  }

  let gymRecommendation = null;
  if (currentActiveGym && bestGymForStat) {
    const currentGymVal = Number(currentActiveGym[recommendedStatName as keyof typeof currentActiveGym] || 0);
    const bestGymVal = Number(bestGymForStat[recommendedStatName as keyof typeof bestGymForStat] || 0);

    if (currentGymVal === 0) {
      gymRecommendation = `Switch to ${bestGymForStat.name} gym: your current active gym does not allow training ${recommendedStatObj.label}!`;
    } else if (bestGymVal > currentGymVal) {
      const pctIncrease = Math.round(((bestGymVal - currentGymVal) / currentGymVal) * 100);
      gymRecommendation = `Switch to ${bestGymForStat.name} gym for optimal ${recommendedStatObj.label} training (+${pctIncrease}% multiplier).`;
    }
  }

  // 7. Calculate Happy Optimizations (Vladar's Formula)
  function calculateBaseGain(statTotal: number, happy: number): number {
    const a = 3.480061091e-7;
    const b = 250;
    const c = 3.091619094e-6;
    const d = 6.82775184551527e-5;
    const e = -0.0301431777;

    const innerTerm = (a * Math.log(happy + b) + c) * statTotal + d * (happy + b) + e;
    return Math.max(0, innerTerm);
  }

  const currentStatVal = recommendedStatObj.current;
  const gainCurrentHappy = calculateBaseGain(currentStatVal, happyCurrent);
  const gainMaxHappy = calculateBaseGain(currentStatVal, happyMaximum);
  const gainBoostedHappy = calculateBaseGain(currentStatVal, happyMaximum + 5000);

  const pctIncreaseToMax = gainCurrentHappy > 0 ? ((gainMaxHappy - gainCurrentHappy) / gainCurrentHappy) * 100 : 0;
  const pctIncreaseToBoosted = gainMaxHappy > 0 ? ((gainBoostedHappy - gainMaxHappy) / gainMaxHappy) * 100 : 0;

  // Build the final recommendation text lines
  const finalLines: string[] = [];

  if (gymRecommendation) {
    finalLines.push(`**Gym Switch**: ${gymRecommendation}`);
  }

  if (happyCurrent > happyMaximum) {
    const now = new Date();
    const mins = now.getUTCMinutes();
    const secs = now.getUTCSeconds();
    const nextTickMins = 15 - (mins % 15);
    const totalSecondsRemaining = nextTickMins * 60 - secs;
    const displayMins = Math.floor(totalSecondsRemaining / 60);
    const displaySecs = totalSecondsRemaining % 60;
    finalLines.push(`**Happy Decay Warning**: Happy is over maximum and will decay in ${displayMins}m ${displaySecs}s. Train immediately!`);
  } else if (happyCurrent < happyMaximum && boosterCooldown < maxBoosterCooldownSeconds && pctIncreaseToMax >= 1.0) {
    let msg = `**Increase Happy**: Happy is suboptimal (${happyCurrent.toLocaleString()} / ${happyMaximum.toLocaleString()}). Increase to max first (increases gains by +${pctIncreaseToMax.toFixed(1)}%). Booster cooldown: ${(boosterCooldown / 3600).toFixed(1)}h / ${(maxBoosterCooldownSeconds / 3600).toFixed(0)}h limit.`;
    if (pctIncreaseToBoosted >= 3.0) {
      msg += ` Boosting Happy over max (+5,000 happy) will yield +${pctIncreaseToBoosted.toFixed(1)}% extra gains.`;
    }
    finalLines.push(msg);
  } else if (happyCurrent >= happyMaximum && boosterCooldown < maxBoosterCooldownSeconds && pctIncreaseToBoosted >= 3.0) {
    finalLines.push(`**Boost Happy**: Boosting Happy over maximum (+5,000 happy using candy/boosters) will increase gains by +${pctIncreaseToBoosted.toFixed(1)}%. Booster cooldown: ${(boosterCooldown / 3600).toFixed(1)}h / ${(maxBoosterCooldownSeconds / 3600).toFixed(0)}h limit.`);
  }

  finalLines.push(recommendationText);
  const finalText = finalLines.join("\n\n");

  return {
    stat: recommendedStatObj.label,
    statKey: recommendedStatObj.name,
    diff: recommendedStatObj.diff,
    text: finalText,
    gymRecommendation,
    currentEnergy,
    maxEnergy,
    currentHappy: happyCurrent,
    maxHappy: happyMaximum,
    factionPerks,
    activeGymName: activeGym.name,
    buildInfo: {
      selectedBuild: build,
      ratios: {
        strength: strengthPct,
        defense: defensePct,
        speed: speedPct,
        dexterity: dexterityPct,
      },
    },
  };
}
