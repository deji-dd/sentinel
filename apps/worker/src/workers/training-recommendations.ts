import { executeSync } from "../lib/sync.js";
import { getPersonalApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { logError } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const TRAINING_RECOMMENDATIONS_WORKER_NAME = "training_recommendations_worker";
const TRAINING_RECOMMENDATIONS_CADENCE_SECONDS = 600; // 10 minutes

// Stat constants for gym gain formula
const STAT_CONSTANTS = {
  strength: { A: 1600, B: 1700, C: 700 },
  speed: { A: 1600, B: 2000, C: 1350 },
  dexterity: { A: 1800, B: 1500, C: 1000 },
  defense: { A: 2100, B: -600, C: 1500 },
} as const;

type StatKey = keyof typeof STAT_CONSTANTS;

interface GymDetails {
  id: number;
  name: string;
  stage: number;
  [key: string]: unknown;
}

interface ItemWithPrice {
  id: number;
  name: string;
  energy_gain: number;
  booster_cooldown_hours: number;
  lowest_market_price: number;
}

interface GymGains {
  strength: number;
  speed: number;
  dexterity: number;
  defense: number;
}

interface TrainingMethodCost {
  method: "item" | "se";
  itemId: number;
  costPerStat: number;
  itemCost: number;
  estimatedGain: number;
  quantityAffordable: number;
  boosterCooldownHours: number;
}

/**
 * Fetch the most recent snapshot with stat breakdown, active gym ID, happy value, and stat gain perks
 */
async function getLatestSnapshot(): Promise<{
  stat_breakdown: Record<string, number>;
  active_gym_id: number | null;
  happy_current: number;
  perk_gains: Record<string, number>;
  liquid_cash: number;
  can_boost_energy_perk: number;
}> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.USER_SNAPSHOTS)
    .select(
      "stat_breakdown, active_gym, happy_current, perk_gains, liquid_cash, can_boost_energy_perk",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Failed to fetch latest snapshot: ${error.message}`);
  }

  return {
    stat_breakdown: data.stat_breakdown || {},
    active_gym_id: data.active_gym,
    happy_current: data.happy_current || 0,
    perk_gains: data.perk_gains || {},
    liquid_cash: data.liquid_cash || 0,
    can_boost_energy_perk: data.can_boost_energy_perk || 0,
  };
}

/**
 * Get gym details for active gym and all unlocked stage 4 gyms
 */
async function getGymDetails(activeGymId: number | null): Promise<{
  activeGym: GymDetails | null;
  stage4Gyms: GymDetails[];
}> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.TORN_GYMS)
    .select("*")
    .eq("unlocked", true);

  if (error) {
    throw new Error(`Failed to fetch gym details: ${error.message}`);
  }

  const gyms = (data || []) as GymDetails[];

  const activeGym = activeGymId
    ? gyms.find((g) => g.id === activeGymId) || null
    : null;

  const stage4Gyms = gyms.filter((g) => g.stage === 4);

  return {
    activeGym,
    stage4Gyms,
  };
}

/**
 * Fetch energy gain items (Dumbbells, Boxing Gloves, Parachute & Skateboard)
 */
async function getEnergyGainItems(): Promise<ItemWithPrice[]> {
  const seItemNames = ["Dumbbells", "Boxing Gloves", "Parachute", "Skateboard"];

  const { data, error } = await supabase
    .from(TABLE_NAMES.TORN_ITEMS)
    .select("id, name, energy_gain, booster_cooldown_hours")
    .gt("energy_gain", 0)
    .in("name", seItemNames);

  if (error) {
    throw new Error(`Failed to fetch energy gain items: ${error.message}`);
  }

  const items = (data || []).map(
    (item: {
      id: number;
      name: string;
      energy_gain: number;
      booster_cooldown_hours: number;
    }) => ({
      id: item.id,
      name: item.name,
      energy_gain: item.energy_gain,
      booster_cooldown_hours: item.booster_cooldown_hours,
      lowest_market_price: 0, // Will be populated next
    }),
  );

  return items;
}

/**
 * Fetch lowest market price for each item from Torn API v2
 * Response itemmarket is already sorted with lowest price first
 */
async function enrichItemsWithMarketPrices(
  items: ItemWithPrice[],
  apiKey: string,
): Promise<ItemWithPrice[]> {
  const seItemNames = ["Dumbbells", "Boxing Gloves", "Parachute", "Skateboard"];
  const isSEItem = (name: string) => seItemNames.includes(name);

  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      try {
        const response = await tornApi.get("/market/{id}/itemmarket", {
          apiKey,
          pathParams: { id: item.id },
        });

        let lowestPrice = 0;

        // itemmarket is an array sorted by price (lowest first), get the first entry
        if (
          response &&
          typeof response === "object" &&
          "itemmarket" in response
        ) {
          const itemmarket = (response as { itemmarket?: unknown }).itemmarket;
          if (Array.isArray(itemmarket) && itemmarket.length > 0) {
            const firstListing = itemmarket[0] as {
              cost?: number;
              [key: string]: unknown;
            };
            lowestPrice = firstListing.cost || 0;
          }
        }

        // Cap SE items at 450,000,000
        if (isSEItem(item.name) && lowestPrice > 450000000) {
          lowestPrice = 450000000;
        }

        return {
          ...item,
          lowest_market_price: lowestPrice,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logError(
          TRAINING_RECOMMENDATIONS_WORKER_NAME,
          `Failed to fetch market price for item ${item.id} (${item.name}): ${errorMsg}`,
        );

        // Return item with price 0 on error
        return {
          ...item,
          lowest_market_price: 0,
        };
      }
    }),
  );

  return enrichedItems;
}

/**
 * Calculate gym gains for each stat using the provided formula
 * dS = (S * ROUND(1 + 0.07 * ROUND(LN(1+H/250),4),4) + 8 * H^1.05 + (1-(H/99999)^2) * A + B) * (1/200000) * G * E * (1+PERK%)
 */
function calculateGymGains(
  stats: Record<string, number>,
  happy: number,
  activeGym: GymDetails | null,
  perkGains: Record<string, number>,
): GymGains {
  if (!activeGym) {
    return { strength: 0, speed: 0, dexterity: 0, defense: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gymDots = ((activeGym as any).dots || 0) / 10; // Convert to decimal (e.g., 73 -> 7.3)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const energy = (activeGym as any).energy || 0; // Energy per train (5, 10, 25, 50, etc)

  const gains: GymGains = {
    strength: 0,
    speed: 0,
    dexterity: 0,
    defense: 0,
  };

  for (const stat of Object.keys(gains) as StatKey[]) {
    // Get stat value, capped at 50,000,000
    const S = Math.min(stats[stat] || 0, 50000000);

    // Base formula components
    const lnComponent = Math.log(1 + happy / 250);
    const lnRounded = Math.round(lnComponent * 10000) / 10000;
    const s1 = Math.round((1 + 0.07 * lnRounded) * 10000) / 10000;

    const constants = STAT_CONSTANTS[stat];
    const h105 = Math.pow(happy, 1.05);
    const happyFactor = 1 - Math.pow(happy / 99999, 2);

    const baseGain =
      S * s1 + 8 * h105 + happyFactor * constants.A + constants.B;

    // Apply formula: baseGain * (1/200000) * G * E * perk multipliers
    let gain = (baseGain / 200000) * gymDots * energy;

    // Apply perk multipliers
    const statPerkKey = `${stat}_gym_gains`;
    const generalPerkKey = "gym_gains";

    if (perkGains[statPerkKey]) {
      gain *= 1 + perkGains[statPerkKey];
    }
    if (perkGains[generalPerkKey]) {
      gain *= 1 + perkGains[generalPerkKey];
    }

    gains[stat] = gain;
  }

  return gains;
}

/**
 * Get training budget from finance settings (single user app, so no player_id filter)
 */
async function getTrainingBudget(currentSnapshot: {
  liquid_cash?: number;
  [key: string]: unknown;
}): Promise<number> {
  const { data: settingsData, error: settingsError } = await supabase
    .from(TABLE_NAMES.FINANCE_SETTINGS)
    .select("min_reserve, split_training, split_bookie, split_gear")
    .limit(1)
    .single();

  if (settingsError || !settingsData) {
    logError(
      TRAINING_RECOMMENDATIONS_WORKER_NAME,
      `Failed to fetch finance settings: ${settingsError?.message || "No data"}`,
    );
    return 0;
  }

  const liquidCash = Number(currentSnapshot?.liquid_cash || 0);
  const minReserve = Number(settingsData.min_reserve || 0);
  const spendableLiquid = Math.max(0, liquidCash - minReserve);

  // Calculate training budget as percentage of spendable liquid
  const splitTotal =
    settingsData.split_training +
    settingsData.split_bookie +
    settingsData.split_gear;
  const normalizedTotal = splitTotal > 0 ? splitTotal : 100;

  const trainingBudget = Math.floor(
    spendableLiquid * (settingsData.split_training / normalizedTotal),
  );

  return trainingBudget;
}

/**
 * Check if current gym is sub-optimal for each stat
 */
function checkSubOptimalGym(
  activeGym: GymDetails | null,
  stage4Gyms: GymDetails[],
): Record<
  StatKey,
  {
    isSubOptimal: boolean;
    currentBonus: number;
    betterGymName: string | null;
    betterBonus: number;
  }
> {
  const result: Record<
    StatKey,
    {
      isSubOptimal: boolean;
      currentBonus: number;
      betterGymName: string | null;
      betterBonus: number;
    }
  > = {
    strength: {
      isSubOptimal: false,
      currentBonus: 0,
      betterGymName: null,
      betterBonus: 0,
    },
    speed: {
      isSubOptimal: false,
      currentBonus: 0,
      betterGymName: null,
      betterBonus: 0,
    },
    dexterity: {
      isSubOptimal: false,
      currentBonus: 0,
      betterGymName: null,
      betterBonus: 0,
    },
    defense: {
      isSubOptimal: false,
      currentBonus: 0,
      betterGymName: null,
      betterBonus: 0,
    },
  };

  if (!activeGym) {
    return result;
  }

  for (const stat of Object.keys(result) as StatKey[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentBonus = (activeGym as any)[stat] || 0;
    result[stat].currentBonus = currentBonus;

    // Find best gym for this stat
    let bestGym: GymDetails | null = null;
    let bestBonus = currentBonus;

    for (const gym of stage4Gyms) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gymBonus = (gym as any)[stat] || 0;
      if (gymBonus > bestBonus) {
        bestBonus = gymBonus;
        bestGym = gym;
      }
    }

    if (bestGym && bestBonus > currentBonus) {
      result[stat].isSubOptimal = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result[stat].betterGymName = (bestGym as any).name || null;
      result[stat].betterBonus = bestBonus;
    }
  }

  return result;
}
function calculateTrainingCosts(
  items: ItemWithPrice[],
  stats: Record<string, number>,
  gymGains: GymGains,
): Record<StatKey, TrainingMethodCost[]> {
  const seItemNames = ["Dumbbells", "Boxing Gloves", "Parachute", "Skateboard"];
  const costs: Record<StatKey, TrainingMethodCost[]> = {
    strength: [],
    speed: [],
    dexterity: [],
    defense: [],
  };

  // Calculate costs for items with energy gain
  for (const item of items) {
    for (const stat of Object.keys(costs) as StatKey[]) {
      const estimatedGain = gymGains[stat] * item.energy_gain;
      const costPerStat =
        estimatedGain > 0 ? item.lowest_market_price / estimatedGain : Infinity;

      costs[stat].push({
        method: "item",
        itemId: item.id,
        costPerStat,
        itemCost: item.lowest_market_price,
        estimatedGain,
        quantityAffordable: 0, // Will be set per-stat in computeTrainingRecommendations
        boosterCooldownHours: item.booster_cooldown_hours,
      });
    }
  }

  // Calculate costs for SE items (flat 1% gain)
  const seItems = items.filter((i) => seItemNames.includes(i.name));
  for (const seItem of seItems) {
    for (const stat of Object.keys(costs) as StatKey[]) {
      const currentStat = stats[stat] || 0;
      const estimatedGain = currentStat * 0.01; // Flat 1% of current stat
      const costPerStat =
        estimatedGain > 0
          ? seItem.lowest_market_price / estimatedGain
          : Infinity;

      costs[stat].push({
        method: "se",
        itemId: seItem.id,
        costPerStat,
        itemCost: seItem.lowest_market_price,
        estimatedGain,
        quantityAffordable: 0, // Will be set per-stat in computeTrainingRecommendations
        boosterCooldownHours: seItem.booster_cooldown_hours,
      });
    }
  }

  // Sort each stat's methods by cost per stat (cheapest first)
  for (const stat of Object.keys(costs) as StatKey[]) {
    costs[stat].sort((a, b) => a.costPerStat - b.costPerStat);
  }

  return costs;
}

/**
 * Get booster cooldown from sentinel_user_cooldowns
 */
async function getBoosterCooldown(): Promise<number> {
  const { data, error } = await supabase
    .from("sentinel_user_cooldowns")
    .select("booster")
    .limit(1)
    .single();

  if (error || !data) {
    logError(
      TRAINING_RECOMMENDATIONS_WORKER_NAME,
      `Failed to fetch booster cooldown: ${error?.message || "No data"}`,
    );
    return 0;
  }

  return data.booster || 0;
}

/**
 * Get user's preferred stat build (if set)
 */
async function getUserBuildPreference(): Promise<{
  mainStat: StatKey | null;
}> {
  const { data, error } = await supabase
    .from(TABLE_NAMES.STAT_BUILD_PREFERENCES)
    .select("main_stat")
    .limit(1)
    .single();

  if (error || !data) {
    // No preference set is not an error, just return null
    return { mainStat: null };
  }

  return { mainStat: data.main_stat as StatKey };
}

/**
 * Main handler for training recommendations
 */
async function computeTrainingRecommendations(): Promise<void> {
  // Fetch latest snapshot
  const snapshot = await getLatestSnapshot();

  // Get the user's API key
  const apiKey = await getPersonalApiKey();

  // Get booster cooldown
  const boosterCooldown = await getBoosterCooldown();

  // Get user's build preference
  const buildPref = await getUserBuildPreference();

  // Get gym details
  const { activeGym, stage4Gyms } = await getGymDetails(snapshot.active_gym_id);

  // Get energy gain items
  let items = await getEnergyGainItems();

  // Enrich with market prices
  items = await enrichItemsWithMarketPrices(items, apiKey);

  // Get training budget
  const trainingBudget = await getTrainingBudget({
    liquid_cash: snapshot.liquid_cash,
  });

  // Check for sub-optimal gyms
  const gymOptimality = checkSubOptimalGym(activeGym, stage4Gyms);

  // Calculate gym gains for each stat
  const gymGains = calculateGymGains(
    snapshot.stat_breakdown,
    snapshot.happy_current,
    activeGym,
    snapshot.perk_gains,
  );

  // Calculate cost per stat for each training method
  const trainingCosts = calculateTrainingCosts(
    items,
    snapshot.stat_breakdown,
    gymGains,
  );

  // Calculate quantity affordable for each method
  for (const stat of Object.keys(trainingCosts) as StatKey[]) {
    for (const method of trainingCosts[stat]) {
      method.quantityAffordable = Math.floor(trainingBudget / method.itemCost);
    }
  }

  // Save recommendations for each stat
  const recommendations = [];
  for (const stat of Object.keys(trainingCosts) as StatKey[]) {
    const costs = trainingCosts[stat];
    if (costs.length === 0) continue;

    // Get the cheapest method
    const cheapest = costs[0];

    const gymInfo = gymOptimality[stat];

    // Determine if this stat is the user's main focus
    const isMainStatFocus = buildPref.mainStat === stat;

    // Priority score: lower = higher priority
    // Main stat focus gets priority 0, others get 1
    // This helps sort recommendations
    const priorityScore = isMainStatFocus ? 0 : 1;

    // Build recommendation object
    const recommendation: Record<string, unknown> = {
      stat,
      best_method_type: cheapest.method,
      best_method_id: cheapest.itemId,
      cost_per_stat: Math.ceil(cheapest.costPerStat),
      estimated_gains_per_train: Math.ceil(cheapest.estimatedGain),
      max_quantity_affordable: cheapest.quantityAffordable,
      training_budget: trainingBudget,
      current_gym_sub_optimal: gymInfo.isSubOptimal,
      better_gym_name: gymInfo.betterGymName,
      better_gym_bonus: gymInfo.betterBonus,
      current_gym_bonus: gymInfo.currentBonus,
      is_main_stat_focus: isMainStatFocus,
      priority_score: priorityScore,
    };

    recommendations.push(recommendation);
  }

  // Clear old recommendations (no player_id filter, single user) and insert new ones
  if (recommendations.length > 0) {
    // Delete old recommendations
    await supabase.from(TABLE_NAMES.TRAINING_RECOMMENDATIONS).delete();

    // Insert new recommendations
    const { error: insertError } = await supabase
      .from(TABLE_NAMES.TRAINING_RECOMMENDATIONS)
      .insert(recommendations);

    if (insertError) {
      throw new Error(
        `Failed to save training recommendations: ${insertError.message}`,
      );
    }

    logError(
      TRAINING_RECOMMENDATIONS_WORKER_NAME,
      `Saved ${recommendations.length} training recommendations (main focus: ${buildPref.mainStat || "not set"})`,
    );
  }
}

/**
 * Start the training recommendations worker (runs every 10 minutes)
 */
export function startTrainingRecommendationsWorker(): void {
  startDbScheduledRunner({
    worker: TRAINING_RECOMMENDATIONS_WORKER_NAME,
    defaultCadenceSeconds: TRAINING_RECOMMENDATIONS_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: TRAINING_RECOMMENDATIONS_WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: computeTrainingRecommendations,
      });
    },
  });
}
