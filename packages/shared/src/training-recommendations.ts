import { Kysely } from "kysely";
import type { DB } from "./db/kysely-types.js";
import { TABLE_NAMES } from "./constants.js";
import { TornApiClient } from "./torn.js";

export function getUnlockedGymIds(
  activeGymId: number,
  stats: { strength: number; speed: number; defense: number; dexterity: number },
  dbGyms: { id: number | null; name: string; unlocked: number | null }[]
): number[] {
  const unlocked: number[] = [];
  const sequentialLimit = activeGymId >= 25 && activeGymId <= 30 ? 24 : activeGymId;
  for (let i = 1; i <= Math.min(sequentialLimit, 24); i++) {
    unlocked.push(i);
  }
  if (activeGymId > 24) {
    unlocked.push(activeGymId);
  }

  const { strength: str, speed: spd, defense: def, dexterity: dex } = stats;
  const purchasedGymIds = new Set(
    dbGyms.filter((g) => g.unlocked === 1 && g.id !== null).map((g) => g.id as number)
  );

  const getSecondHighest = (others: number[]) => Math.max(...others);

  if (purchasedGymIds.has(25) && (def + dex) >= 1.25 * (str + spd)) {
    if (!unlocked.includes(25)) unlocked.push(25);
  }
  if (purchasedGymIds.has(26) && (str + spd) >= 1.25 * (def + dex)) {
    if (!unlocked.includes(26)) unlocked.push(26);
  }
  if (purchasedGymIds.has(27) && str >= 1.25 * getSecondHighest([spd, def, dex])) {
    if (!unlocked.includes(27)) unlocked.push(27);
  }
  if (purchasedGymIds.has(28) && def >= 1.25 * getSecondHighest([str, spd, dex])) {
    if (!unlocked.includes(28)) unlocked.push(28);
  }
  if (purchasedGymIds.has(29) && spd >= 1.25 * getSecondHighest([str, def, dex])) {
    if (!unlocked.includes(29)) unlocked.push(29);
  }
  if (purchasedGymIds.has(30) && dex >= 1.25 * getSecondHighest([str, spd, def])) {
    if (!unlocked.includes(30)) unlocked.push(30);
  }
  if (purchasedGymIds.has(33)) {
    if (!unlocked.includes(33)) unlocked.push(33);
  }
  return unlocked;
}

export function getStatPerkMultiplier(
  perksResponse: any,
  statName: "strength" | "speed" | "defense" | "dexterity"
): number {
  let multiplier = 1.0;
  if (!perksResponse) return multiplier;

  const perkCategories = [
    perksResponse.faction_perks,
    perksResponse.property_perks,
    perksResponse.education_perks,
    perksResponse.job_perks,
    perksResponse.merit_perks,
    perksResponse.enhancer_perks,
    perksResponse.book_perks,
  ];

  const gymPerkRegex = /([+-]?\d+(?:\.\d+)?)\s*%\s*(strength|defense|speed|dexterity)?\s*gym\s*gains/i;

  for (const list of perkCategories) {
    if (!list || !Array.isArray(list)) continue;
    for (const perk of list) {
      if (typeof perk !== "string") continue;
      const match = perk.match(gymPerkRegex);
      if (match) {
        const pct = parseFloat(match[1]);
        const targetStat = match[2]?.toLowerCase();
        if (!targetStat || targetStat === statName) {
          multiplier *= (1 + pct / 100);
        }
      }
    }
  }

  return multiplier;
}

export function calculateExactGymGain(
  statName: "strength" | "speed" | "defense" | "dexterity",
  statValue: number,
  happy: number,
  gymDots: number,
  energyUsed: number,
  perkMultiplier: number
): number {
  const S = Math.min(50000000, statValue);
  const H = happy;

  const lnPart = Math.round(Math.log(1 + H / 250) * 10000) / 10000;
  const happyFactor = Math.round((1 + 0.07 * lnPart) * 10000) / 10000;

  const happyPower = 8 * Math.pow(H, 1.05);

  let A_stat = 0;
  let B_stat = 0;
  if (statName === "strength") {
    A_stat = 1600;
    B_stat = 1700;
  } else if (statName === "speed") {
    A_stat = 1600;
    B_stat = 2000;
  } else if (statName === "defense") {
    A_stat = 2100;
    B_stat = -600;
  } else if (statName === "dexterity") {
    A_stat = 1800;
    B_stat = 1500;
  }

  const statPart = (1 - Math.pow(H / 99999, 2)) * A_stat + B_stat;

  const baseGain = S * happyFactor + happyPower + statPart;

  const dS = baseGain * (1 / 200000) * gymDots * energyUsed * perkMultiplier;

  return Math.max(0, dS);
}

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
  energyDrinkBoost?: number;
  buildInfo: {
    selectedBuild: string;
    ratios: {
      strength: number;
      defense: number;
      speed: number;
      dexterity: number;
    };
  };
  expectedGainPerEnergy?: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
  };
  perkMultipliers?: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
  };
}

export async function getPersonalTrainingRecommendations(
  db: Kysely<DB>,
  userId: string,
  apiKey?: string,
  tornApi?: TornApiClient,
  prefetchedPerks?: any
): Promise<TrainingRecommendationResult> {
  let energyDrinkBoost = 0;
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
  const happyCurrent = userSnapshot?.happy_current !== undefined && userSnapshot?.happy_current !== null ? Number(userSnapshot.happy_current) : 5000;
  const happyMaximum = userSnapshot?.happy_maximum !== undefined && userSnapshot?.happy_maximum !== null ? Number(userSnapshot.happy_maximum) : 5000;
  const boosterCooldown = userSnapshot?.booster_cooldown ? Number(userSnapshot.booster_cooldown) : 0;

  const allGyms = await db
    .selectFrom(TABLE_NAMES.TORN_GYMS)
    .selectAll()
    .execute();

  const activeGymIdNum = activeGymId ? Number(activeGymId) : 1;
  const currentActiveGym = allGyms.find((g) => g.id === activeGymIdNum);

  let activeGym = {
    name: "Premier Fitness",
    strength: 20,
    speed: 20,
    defense: 20,
    dexterity: 20,
  };

  if (currentActiveGym) {
    activeGym = {
      name: currentActiveGym.name,
      strength: currentActiveGym.strength,
      speed: currentActiveGym.speed,
      defense: currentActiveGym.defense,
      dexterity: currentActiveGym.dexterity,
    };
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

  // 4. Fetch Faction Perks (Steadfast) from Torn API
  const factionPerks: FactionPerks = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
  let maxBoosterCooldownMins = 24 * 60; // default 24h
  let perkMultipliers = { strength: 1.0, speed: 1.0, defense: 1.0, dexterity: 1.0 };

  if (prefetchedPerks || apiKey) {
    try {
      const client = tornApi || new TornApiClient();
      const perksResponse = prefetchedPerks || await client.getRaw<any>("/user", apiKey!, {
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
          } else if (Array.isArray(val)) {
            for (const v of val) {
              if (typeof v === "string") {
                perkStrings.push(v);
              }
            }
          }
        }
      }

      const gymPerkRegex = /([+-]?\d+)\s*%\s*(strength|defense|speed|dexterity)\s*gym\s*gains/i;
      const energyDrinkPerkRegex = /([+-]?\d+)\s*%\s*energy\s*gain\s*from\s*energy\s*drinks/i;
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

        const energyDrinkMatch = str.match(energyDrinkPerkRegex);
        if (energyDrinkMatch) {
          energyDrinkBoost += parseInt(energyDrinkMatch[1], 10);
        }
      }

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

      perkMultipliers = {
        strength: getStatPerkMultiplier(perksResponse, "strength"),
        speed: getStatPerkMultiplier(perksResponse, "speed"),
        defense: getStatPerkMultiplier(perksResponse, "defense"),
        dexterity: getStatPerkMultiplier(perksResponse, "dexterity"),
      };
    } catch (err) {
      console.error("[Training Recommendations Utility] Failed to fetch perks from Torn:", err);
    }
  }

  if (boosterCooldown > 24 * 60 * 60) {
    maxBoosterCooldownMins = Math.max(maxBoosterCooldownMins, 48 * 60);
  }
  const maxBoosterCooldownSeconds = maxBoosterCooldownMins * 60;

  const unlockedIds = getUnlockedGymIds(activeGymIdNum, statsData, allGyms);
  const unlockedGyms = allGyms.filter((g) => g.id !== null && unlockedIds.includes(g.id));

  const maxStrengthMult = Math.max(...unlockedGyms.map((g) => Number(g.strength || 0)), 20);
  const maxDefenseMult = Math.max(...unlockedGyms.map((g) => Number(g.defense || 0)), 20);
  const maxSpeedMult = Math.max(...unlockedGyms.map((g) => Number(g.speed || 0)), 20);
  const maxDexterityMult = Math.max(...unlockedGyms.map((g) => Number(g.dexterity || 0)), 20);

  // Calculate training multiplier for each stat (gym multiplier * full multiplicative perks)
  const strGymMult = (maxStrengthMult / 10) * perkMultipliers.strength;
  const defGymMult = (maxDefenseMult / 10) * perkMultipliers.defense;
  const spdGymMult = (maxSpeedMult / 10) * perkMultipliers.speed;
  const dexGymMult = (maxDexterityMult / 10) * perkMultipliers.dexterity;

  const statsBehind = [
    { name: "strength", label: "Strength", diff: diffStr, current: currentStr, target: targetStr, gymMult: strGymMult },
    { name: "defense", label: "Defense", diff: diffDef, current: currentDef, target: targetDef, gymMult: defGymMult },
    { name: "speed", label: "Speed", diff: diffSpd, current: currentSpd, target: targetSpd, gymMult: spdGymMult },
    { name: "dexterity", label: "Dexterity", diff: diffDex, current: currentDex, target: targetDex, gymMult: dexGymMult },
  ];

  // Calculate focus recommendation score = relative difference * active gym multiplier
  const getRecommendationScore = (s: typeof statsBehind[0]) => {
    if (s.diff <= 0) return s.diff; // negative or zero difference
    const relativeDifference = s.target > 0 ? s.diff / s.target : 0;
    return relativeDifference * s.gymMult;
  };

  const sortedBehind = [...statsBehind].sort((a, b) => getRecommendationScore(b) - getRecommendationScore(a));
  const recommendedStatObj = sortedBehind[0];

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
  function calculateExpectedGain(statVal: number, happy: number): number {
    const S_capped = Math.min(50_000_000, statVal);
    const H = happy;

    let A = 1600;
    let B = 1700;
    if (recommendedStatName === "speed") {
      A = 1600;
      B = 2000;
    } else if (recommendedStatName === "dexterity") {
      A = 1800;
      B = 1500;
    } else if (recommendedStatName === "defense") {
      A = 2100;
      B = -600;
    }

    const term1 = S_capped * (1 + 0.07 * Math.log(1 + H / 250));
    const term2 = 8 * Math.pow(H, 1.05);
    const term3 = (1 - Math.pow(H / 99999, 2)) * A;
    const term4 = B;

    return Math.max(0, term1 + term2 + term3 + term4);
  }

  const currentStatVal = recommendedStatObj.current;
  const gainCurrentHappy = calculateExpectedGain(currentStatVal, happyCurrent);
  const gainMaxHappy = calculateExpectedGain(currentStatVal, happyMaximum);
  const gainBoostedHappy = calculateExpectedGain(currentStatVal, happyMaximum + 5000);

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
  } else if (happyCurrent < happyMaximum && boosterCooldown < maxBoosterCooldownSeconds) {
    let msg = `**Increase Happy**: Increase your happy to ${happyMaximum.toLocaleString()} (current: ${happyCurrent.toLocaleString()} / ${happyMaximum.toLocaleString()}) first (increases gains by +${pctIncreaseToMax.toFixed(1)}%). Booster cooldown: ${(boosterCooldown / 3600).toFixed(1)}h / ${(maxBoosterCooldownSeconds / 3600).toFixed(0)}h limit.`;
    if (pctIncreaseToBoosted >= 3.0) {
      msg += ` Boosting Happy over max (+5,000 happy) will yield +${pctIncreaseToBoosted.toFixed(1)}% extra gains.`;
    }
    finalLines.push(msg);
  } else if (happyCurrent >= happyMaximum && boosterCooldown < maxBoosterCooldownSeconds && pctIncreaseToBoosted >= 3.0) {
    finalLines.push(`**Boost Happy**: Boosting Happy over maximum (+5,000 happy using candy/boosters) will increase gains by +${pctIncreaseToBoosted.toFixed(1)}%. Booster cooldown: ${(boosterCooldown / 3600).toFixed(1)}h / ${(maxBoosterCooldownSeconds / 3600).toFixed(0)}h limit.`);
  }

  finalLines.push(recommendationText);
  const finalText = finalLines.join("\n\n");

  const happyVal = Math.max(1, happyCurrent);
  const expectedGainStr = calculateExactGymGain("strength", currentStr, happyVal, maxStrengthMult / 10, 1, perkMultipliers.strength);
  const expectedGainDef = calculateExactGymGain("defense", currentDef, happyVal, maxDefenseMult / 10, 1, perkMultipliers.defense);
  const expectedGainSpd = calculateExactGymGain("speed", currentSpd, happyVal, maxSpeedMult / 10, 1, perkMultipliers.speed);
  const expectedGainDex = calculateExactGymGain("dexterity", currentDex, happyVal, maxDexterityMult / 10, 1, perkMultipliers.dexterity);

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
    energyDrinkBoost,
    buildInfo: {
      selectedBuild: build,
      ratios: {
        strength: strengthPct,
        defense: defensePct,
        speed: speedPct,
        dexterity: dexterityPct,
      },
    },
    expectedGainPerEnergy: {
      strength: expectedGainStr,
      speed: expectedGainSpd,
      defense: expectedGainDef,
      dexterity: expectedGainDex,
    },
    perkMultipliers,
  };
}
