export type StatType = "strength" | "defense" | "speed" | "dexterity";
export type BuildType = "balanced" | "hanks" | "baldrs";

export interface GymStateData {
  battlestats: {
    strength: number;
    defense: number;
    speed: number;
    dexterity: number;
  };
  gym_unlocks: {
    strength_gym: number;
    defense_gym: number;
    speed_gym: number;
    dexterity_gym: number;
  };
  gym_perks: {
    strength_gain_modifier: number;
    speed_gain_modifier: number;
    defense_gain_modifier: number;
    dexterity_gain_modifier: number;
  };
  booster_perks?: {
    energy_drink_modifier: number;
  };
  bars: {
    energy_maximum: number;
    happy_maximum: number;
  };
  gym_build_preference: {
    build_type: BuildType;
    high_stat: StatType;
  };
  gyms: Array<{
    id: string;
    name: string;
    energy: number;
    strength: number;
    defense: number;
    speed: number;
    dexterity: number;
  }>;
  items?: Array<{
    id: number;
    name: string;
    effect: string;
    type: string;
    details: {
      category: string;
    };
    value: {
      market_price: number;
    };
  }>;
  backfill_progress?: {
    status: "in_progress" | "completed" | "error";
    logs_parsed?: number;
    oldest_timestamp_reached?: number | null;
    error?: string;
  };
}

const STAT_CONSTANTS = {
  strength: { a: 1600, b: 1700 },
  speed: { a: 1600, b: 2000 },
  dexterity: { a: 1800, b: 1500 },
  defense: { a: 2100, b: -600 },
};

/**
 * Calculates the estimated gain for a single train.
 */
export function calculateGymGain(
  statValue: number,
  happy: number,
  gymDots: number,
  energyPerTrain: number,
  perkMultiplier: number,
  statType: StatType
): number {
  const S = Math.min(statValue, 50_000_000);
  const H = happy;
  const G = gymDots / 10;
  const E = energyPerTrain;
  
  // Convert 30 to 0.3
  const PERK = perkMultiplier / 100;
  
  const A = STAT_CONSTANTS[statType].a;
  const B = STAT_CONSTANTS[statType].b;

  // S * ROUND(1 + 0.07 * ROUND(LN(1+H/250),4),4)
  const lnTerm = Number((Math.log(1 + H / 250)).toFixed(4));
  const happyMultiplier = Number((1 + 0.07 * lnTerm).toFixed(4));
  const term1 = S * happyMultiplier;

  // 8 * H^1.05
  const term2 = 8 * Math.pow(H, 1.05);

  // (1-(H/99999)^2) * A
  const term3 = (1 - Math.pow(H / 99999, 2)) * A;

  // Total base before multipliers
  const base = term1 + term2 + term3 + B;

  // * (1/200000) * G * E * (1+PERK)
  const total = base * (1 / 200000) * G * E * (1 + PERK);

  return total;
}

/**
 * Returns the target percentages for each stat based on the build type and high stat.
 */
export function getTargetRatios(buildType: BuildType, highStat: StatType): Record<StatType, number> {
  const ratios = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
  
  if (buildType === "balanced") {
    ratios.strength = 25;
    ratios.defense = 25;
    ratios.speed = 25;
    ratios.dexterity = 25;
    return ratios;
  }
  
  // For Hank's Ratio: High Stat = 34.72%, Low Stat = 9.72%, Others = 27.78%
  // The "Low Stat" is paired (Defense/Dexterity or Strength/Speed)
  if (buildType === "hanks") {
    const HIGH = 34.72;
    const LOW = 9.72;
    const MID = 27.78;
    
    // Default all to MID
    ratios.strength = MID;
    ratios.defense = MID;
    ratios.speed = MID;
    ratios.dexterity = MID;
    
    ratios[highStat] = HIGH;
    
    if (highStat === "defense") ratios.dexterity = LOW;
    if (highStat === "dexterity") ratios.defense = LOW;
    if (highStat === "strength") ratios.speed = LOW;
    if (highStat === "speed") ratios.strength = LOW;
    
    return ratios;
  }
  
  // For Baldr's Ratio: High Stat = 30.86%, Secondary = 24.69%, Others = 22.22%
  if (buildType === "baldrs") {
    const HIGH = 30.86;
    const SEC = 24.69;
    const LOW = 22.22;
    
    ratios.strength = LOW;
    ratios.defense = LOW;
    ratios.speed = LOW;
    ratios.dexterity = LOW;
    
    ratios[highStat] = HIGH;
    
    if (highStat === "strength") ratios.speed = SEC;
    if (highStat === "speed") ratios.strength = SEC;
    if (highStat === "defense") ratios.dexterity = SEC;
    if (highStat === "dexterity") ratios.defense = SEC;
    
    return ratios;
  }
  
  return ratios;
}

export function calculateEfficiencyData(state: GymStateData) {
  if (!state.battlestats) return [];

  const stats: StatType[] = ["strength", "defense", "speed", "dexterity"];
  
  const totalStats = 
    state.battlestats.strength + 
    state.battlestats.defense + 
    state.battlestats.speed + 
    state.battlestats.dexterity;
    
  const targetRatios = getTargetRatios(
    state.gym_build_preference.build_type, 
    state.gym_build_preference.high_stat
  );

  const results = stats.map(stat => {
    const currentValue = state.battlestats[stat];
    const currentPercentage = totalStats > 0 ? (currentValue / totalStats) * 100 : 25;
    const targetPercentage = targetRatios[stat];
    const targetValue = (targetPercentage / 100) * totalStats;
    
    // How far behind target (positive means we need more of this stat, negative means we have too much)
    const deficitPercentage = targetPercentage - currentPercentage;
    
    // Gym Info
    const gymIdKey = `${stat}_gym` as keyof typeof state.gym_unlocks;
    const gymId = state.gym_unlocks ? state.gym_unlocks[gymIdKey] : null;
    const bestGym = state.gyms?.find(g => Number(g.id) === gymId);
    
    const gymDots = bestGym ? bestGym[stat] : 0;
    const energyPerTrain = bestGym ? bestGym.energy : 5;
    
    // Estimated Gain (dS)
    const happyMax = state.bars?.happy_maximum || 4000; // sensible default if missing
    const perkMultiplier = state.gym_perks ? state.gym_perks[`${stat}_gain_modifier` as keyof typeof state.gym_perks] || 0 : 0;

    const estimatedGain = calculateGymGain(
      currentValue,
      happyMax,
      gymDots,
      energyPerTrain,
      perkMultiplier,
      stat
    );

    // Efficiency Score (dS per energy)
    const efficiency = energyPerTrain > 0 ? estimatedGain / energyPerTrain : 0;

    return {
      stat,
      currentValue,
      targetValue,
      currentPercentage,
      targetPercentage,
      deficitPercentage,
      bestGym,
      estimatedGain,
      efficiency,
      energyPerTrain,
    };
  });

  // Calculate the maximum efficiency to normalize it for the score
  const maxEfficiency = Math.max(...results.map(r => r.efficiency));

  // Combine deficit and efficiency into a final "Train Score"
  // If a stat is wildly over ratio (deficit < -5%), penalize heavily
  // If a stat is behind ratio (deficit > 0), bonus it
  // Then weight by efficiency
  const scoredResults = results.map(r => {
    // Normalize efficiency from 0 to 1
    const normalizedEfficiency = maxEfficiency > 0 ? r.efficiency / maxEfficiency : 0;
    
    // Deficit is directly used as a percentage (e.g. 5 means 5% behind)
    // We want efficiency to matter a lot, but not if the deficit is terribly negative.
    let score = normalizedEfficiency * 100; // base score 0-100 based on efficiency
    
    // Add the deficit multiplied by a weight (e.g., 10 points per 1% behind)
    score += r.deficitPercentage * 10;
    
    // Cap penalization if it's slightly over, but heavy penalty if extremely over
    if (r.deficitPercentage < -10) {
      score -= 500; // Basically never train this if it's 10% over the target ratio
    }
    
    return { ...r, score };
  });

  scoredResults.sort((a, b) => b.score - a.score);

  return scoredResults;
}

export interface BoosterEfficiency {
  id: number;
  name: string;
  itemType: "energy_drink" | "fhc" | "stat_enhancer";
  stat: StatType | "all";
  statGain: number;
  marketPrice: number;
  costPerStat: number;
  cooldownHours: number;
  costToTarget: number; // Cost to reach 1% stat gain (SE equivalent)
  cdToTarget: number; // CD hours to reach 1% stat gain (SE equivalent)
}

/**
 * Calculates the efficiency of boosters (Energy drinks, FHC, Stat Enhancers)
 * factoring in the current gym state and market prices.
 */
export function calculateBoosterEfficiency(
  state: GymStateData
): Record<StatType, BoosterEfficiency[]> {
  const result: Record<StatType, BoosterEfficiency[]> = {
    strength: [],
    defense: [],
    speed: [],
    dexterity: [],
  };

  if (!state.items || !state.battlestats) return result;

  const stats: StatType[] = ["strength", "defense", "speed", "dexterity"];
  const efficiencyData = calculateEfficiencyData(state);

  // Find the best gym for each stat
  const bestGyms = stats.reduce((acc, stat) => {
    const statData = efficiencyData.find(d => d.stat === stat);
    acc[stat] = {
      gymId: statData?.bestGym?.id || "1",
      cost: statData?.energyPerTrain || 10,
      gainPerTrain: statData?.estimatedGain || 0,
    };
    return acc;
  }, {} as Record<StatType, { gymId: string; cost: number; gainPerTrain: number }>);

  const energyDrinkModifier =
    1 + (state.booster_perks?.energy_drink_modifier || 0);

  state.items.forEach((item) => {
    // Stat Enhancer
    if (
      ["Skateboard", "Parachute", "Boxing Gloves", "Dumbbells"].includes(
        item.name
      )
    ) {
      let stat: StatType = "strength";
      if (item.name === "Skateboard") stat = "speed";
      if (item.name === "Parachute") stat = "dexterity";
      if (item.name === "Boxing Gloves") stat = "defense";
      if (item.name === "Dumbbells") stat = "strength";

      const currentStatValue = state.battlestats[stat];
      const statGain = Math.floor(currentStatValue * 0.01);
      const targetGain = Math.max(1, Math.floor(currentStatValue * 0.01));

      if (statGain > 0) {
        const itemsNeeded = targetGain / statGain;
        result[stat].push({
          id: item.id,
          name: item.name,
          itemType: "stat_enhancer",
          stat,
          statGain,
          marketPrice: item.value.market_price,
          costPerStat: item.value.market_price / statGain,
          cooldownHours: 6,
          costToTarget: itemsNeeded * item.value.market_price,
          cdToTarget: itemsNeeded * 6,
        });
      }
    }

    // Feathery Hotel Coupon
    else if (item.name.includes("Feathery Hotel Coupon")) {
      const energyGained = state.bars.energy_maximum;

      stats.forEach((stat) => {
        const bg = bestGyms[stat];
        const currentStatValue = state.battlestats[stat];
        const targetGain = Math.max(1, Math.floor(currentStatValue * 0.01));

        if (bg.gainPerTrain > 0) {
          const trains = energyGained / bg.cost;
          const statGain = trains * bg.gainPerTrain;
          const itemsNeeded = targetGain / statGain;

          result[stat].push({
            id: item.id,
            name: item.name,
            itemType: "fhc",
            stat,
            statGain,
            marketPrice: item.value.market_price,
            costPerStat: item.value.market_price / statGain,
            cooldownHours: 6,
            costToTarget: itemsNeeded * item.value.market_price,
            cdToTarget: itemsNeeded * 6,
          });
        }
      });
    }
  });

  const canGroups: Record<number, { id: number, name: string, baseEnergy: number, marketPrice: number }> = {};

  state.items.forEach(item => {
    if (item.type === "Energy Drink") {
      const match = item.effect?.match(/energy by (\d+)/i);
      if (match) {
        const baseEnergy = parseInt(match[1], 10);
        if (!canGroups[baseEnergy] || item.value.market_price < canGroups[baseEnergy].marketPrice) {
          canGroups[baseEnergy] = {
            id: item.id,
            name: `${baseEnergy}E Can`, // Renaming it here
            baseEnergy,
            marketPrice: item.value.market_price
          };
        }
      }
    }
  });

  // Process grouped cans
  Object.values(canGroups).forEach(can => {
    const energyGained = can.baseEnergy * energyDrinkModifier;
    
    stats.forEach((stat) => {
      const bg = bestGyms[stat];
      const currentStatValue = state.battlestats[stat];
      const targetGain = Math.max(1, Math.floor(currentStatValue * 0.01));

      if (bg.gainPerTrain > 0) {
        const trains = energyGained / bg.cost;
        const statGain = trains * bg.gainPerTrain;
        const itemsNeeded = targetGain / statGain;

        result[stat].push({
          id: can.id,
          name: can.name,
          itemType: "energy_drink",
          stat,
          statGain,
          marketPrice: can.marketPrice,
          costPerStat: can.marketPrice / statGain,
          cooldownHours: 2,
          costToTarget: itemsNeeded * can.marketPrice,
          cdToTarget: itemsNeeded * 2,
        });
      }
    });
  });

  // By default sort each array by costToTarget ascending (lowest cost to reach 1% = most cost efficient)
  // The UI can toggle sorting to cdToTarget
  stats.forEach((stat) => {
    result[stat].sort((a, b) => a.costToTarget - b.costToTarget);
  });

  return result;
}
