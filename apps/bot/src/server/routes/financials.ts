import { Router, type Request, type Response } from "express";
import { TABLE_NAMES, calculateStockIncrementROI } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { getServerContext } from "../context.js";

export const financialsRouter = Router();

financialsRouter.get("/stocks", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  try {
    const session = await magicLinkService.validateSession(token, "config");
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Owner access only" });
    }

    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "SENTINEL_USER_ID is not configured on server" });
    }

    // 1. Fetch current stock market records
    const stocks = await db
      .selectFrom(TABLE_NAMES.TORN_STOCKS)
      .selectAll()
      .execute();

    // 2. Fetch point price and average property price from market_prices
    const marketPrices = await db
      .selectFrom(TABLE_NAMES.MARKET_PRICES)
      .select(["key", "value"])
      .execute();

    const priceMap = new Map<string, number>();
    for (const row of marketPrices) {
      priceMap.set(row.key, Number(row.value));
    }

    // 3. Fetch item prices and images map
    const items = await db
      .selectFrom(TABLE_NAMES.TORN_ITEMS)
      .select(["name", "value", "image"])
      .execute();

    const itemPricesMap = new Map<string, number>();
    const itemImagesMap = new Map<string, string>();
    for (const item of items) {
      if (item.name) {
        const lowerName = item.name.toLowerCase();
        itemPricesMap.set(lowerName, item.value ?? 0);
        if (item.image) {
          itemImagesMap.set(lowerName, item.image);
        }
      }
    }

    // 4. Fetch owned assets from user_assets
    const ownedAssets = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selectFrom(TABLE_NAMES.USER_ASSETS as any)
      .select(["asset_key", "quantity"])
      .where("asset_type", "=", "stock")
      .execute();

    const ownedMap = new Map<string, number>();
    for (const row of ownedAssets) {
      ownedMap.set(row.asset_key, Number(row.quantity));
    }

    // Fetch property assets from user_assets
    const propertyAssets = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selectFrom(TABLE_NAMES.USER_ASSETS as any)
      .select(["asset_key", "quantity"])
      .where("asset_type", "=", "property")
      .execute();

    const propertiesMap = new Map<string, number>();
    for (const row of propertyAssets) {
      propertiesMap.set(row.asset_key, Number(row.quantity));
    }

    const ownedBasePi = propertiesMap.get("owned_base_pi") ?? 0;
    const ownedMaxedPi = propertiesMap.get("owned_maxed_pi") ?? 0;
    const spousePiUpkeep = propertiesMap.get("spouse_pi_upkeep") ?? 0;

    // Fetch latest combat stats snapshots to calculate Stat Enhancers utility
    const latestStats = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS as any)
      .select(["strength", "defense", "speed", "dexterity"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();

    const currentStrength = latestStats?.strength ? Number(latestStats.strength) : 10000000;
    const currentDefense = latestStats?.defense ? Number(latestStats.defense) : 10000000;
    const currentSpeed = latestStats?.speed ? Number(latestStats.speed) : 10000000;
    const currentDexterity = latestStats?.dexterity ? Number(latestStats.dexterity) : 10000000;

    // Fetch personal settings for gym target ratios
    const personalSettings = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS as any)
      .select(["target_strength_ratio", "target_defense_ratio", "target_speed_ratio", "target_dexterity_ratio"])
      .where("user_id", "=", String(userId))
      .executeTakeFirst();

    const targetStrRatio = personalSettings?.target_strength_ratio !== undefined ? Number(personalSettings.target_strength_ratio) : 25;
    const targetDefRatio = personalSettings?.target_defense_ratio !== undefined ? Number(personalSettings.target_defense_ratio) : 25;
    const targetSpdRatio = personalSettings?.target_speed_ratio !== undefined ? Number(personalSettings.target_speed_ratio) : 25;
    const targetDexRatio = personalSettings?.target_dexterity_ratio !== undefined ? Number(personalSettings.target_dexterity_ratio) : 25;

    // Fetch live average training efficiency (stats gained per 1 Energy)
    const logsSummary = await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .selectFrom("sentinel_gym_train_logs" as any)
      .select([
        db.fn.sum("gain").as("total_gain"),
        db.fn.sum("energy").as("total_energy")
      ])
      .executeTakeFirst();

    let statsPerEnergy = 4000; // default fallback
    if (logsSummary?.total_energy && Number(logsSummary.total_energy) > 0) {
      statsPerEnergy = Number(logsSummary.total_gain) / Number(logsSummary.total_energy);
    }

    // 5. Build base valuation configs
    const valuationConfig = {
      points: priceMap.get("points") ?? 31000,
      average_property_cost: priceMap.get("average_property_cost") ?? 8100000,
    };

    // 6. Generate individual rows for all increments (up to 3 for active stocks, 1 for passive)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generatedIncrements: any[] = [];

    for (const s of stocks) {
      const isPassive = Number(s.bonus_passive) === 1;
      const ownedQuantity = ownedMap.get(s.acronym) ?? 0;
      
      const maxIncrements = isPassive ? 1 : 3;

      for (let incIdx = 1; incIdx <= maxIncrements; incIdx++) {
        const isOwned = ownedQuantity >= incIdx;

        const roiInfo = calculateStockIncrementROI(
          {
            acronym: s.acronym,
            price: Number(s.price),
            bonus_requirement: Number(s.bonus_requirement),
            bonus_frequency: Number(s.bonus_frequency),
            bonus_description: s.bonus_description,
            bonus_passive: isPassive,
          },
          itemPricesMap,
          incIdx,
          valuationConfig
        );

        generatedIncrements.push({
          id: `${s.stock_id}_inc_${incIdx}`,
          stock_id: s.stock_id,
          name: s.name,
          acronym: s.acronym,
          logo: s.logo_image,
          full: s.full_image,
          price: Number(s.price),
          market_cap: Number(s.market_cap),
          shares: Number(s.shares),
          investors: Number(s.investors),
          ownedQuantity,
          isOwned,
          incrementIndex: incIdx,
          isPassive,
          showRoi: true,
          bonus: {
            passive: isPassive,
            frequency: Number(s.bonus_frequency),
            requirement: Number(s.bonus_requirement),
            description: isPassive
              ? `${s.bonus_description} (Passive)`
              : `${s.bonus_description} (${Number(s.bonus_frequency) === 7 ? "Weekly" : Number(s.bonus_frequency) === 31 ? "Monthly" : `Every ${s.bonus_frequency} days`})`,
          },
          roi: roiInfo,
        });
      }
    }

    // 6.5 Add virtual Private Island roadmap increments
    // A. Base PI
    const basePiCost = 475000000;
    const basePiUpkeepSavedAnnual = spousePiUpkeep * 365;
    const isBasePiOwned = ownedBasePi === 1;

    // Happy penalty: moving from a spouse's 4525 happy PI to a 2000 happy Base PI costs -2525 happy capacity,
    // which drastically reduces gym training gains. Valuing 1 happy point loss at $36,500/yr:
    const basePiHappyPenalty = spousePiUpkeep > 0 ? -92162500 : 0;

    const basePiFinancial = basePiUpkeepSavedAnnual;
    const basePiGameplay = basePiHappyPenalty;
    const basePiStrategic = 100000000; // Vault necessity
    const basePiTotalUtility = basePiFinancial + basePiGameplay + basePiStrategic;
    const basePiPes = (basePiTotalUtility / basePiCost) * 100;

    generatedIncrements.push({
      id: "property_base_pi",
      stock_id: 10001,
      name: "Private Island (Base)",
      acronym: "PI (Base)",
      logo: "https://www.torn.com/images/v2/properties/350x230/350x230_default_private_island.png?v=2025-04",
      full: null,
      price: basePiCost,
      market_cap: 0,
      shares: 0,
      investors: 0,
      ownedQuantity: ownedBasePi,
      isOwned: isBasePiOwned,
      incrementIndex: 1,
      isPassive: false,
      showRoi: true,
      bonus: {
        passive: false,
        frequency: 1,
        requirement: 1,
        description: spousePiUpkeep > 0
          ? `Vault access (Cash safety). Saves daily spouse upkeep of $${spousePiUpkeep.toLocaleString()}/day. NOTE: Moving in reduces happy to 2000 (gym training penalty).`
          : "Vault access (Cash safety). Purchase your own Private Island.",
      },
      roi: {
        cost: basePiCost,
        benefitType: "cash",
        itemName: "Upkeep & Vault",
        benefitAmount: spousePiUpkeep,
        occurenceValue: spousePiUpkeep,
        annualYield: basePiUpkeepSavedAnnual,
        roiPercent: (basePiUpkeepSavedAnnual / basePiCost) * 100,
        incrementIndex: 1,
        sharesRequirement: 1,
        totalSharesAccumulated: 1,
        financialValue: basePiFinancial,
        gameplayValue: basePiGameplay,
        strategicValue: basePiStrategic,
        pesScore: basePiPes,
      },
    });

    // B. Maxed PI
    const maxedPiCost = isBasePiOwned ? 1125000000 : 1600000000;
    const travelYieldAnnual = 251850000; // airstrip capacity/fees savings
    const happyGainUtilityAnnual = 18250000; // +500 max happy training boost ($50k/day)
    const isMaxedPiOwned = ownedMaxedPi === 1;

    const maxedPiFinancial = basePiUpkeepSavedAnnual;
    const maxedPiGameplay = travelYieldAnnual + happyGainUtilityAnnual;
    const maxedPiStrategic = 50000000 + 50000000; // Airstrip time saving + Large Vault utility
    const maxedPiTotalUtility = maxedPiFinancial + maxedPiGameplay + maxedPiStrategic;
    const maxedPiPes = (maxedPiTotalUtility / maxedPiCost) * 100;

    generatedIncrements.push({
      id: "property_maxed_pi",
      stock_id: 10002,
      name: "Private Island (Maxed)",
      acronym: "PI (Maxed)",
      logo: "https://www.torn.com/images/v2/properties/350x230/350x230_default_private_island.png?v=2025-04",
      full: null,
      price: maxedPiCost,
      market_cap: 0,
      shares: 0,
      investors: 0,
      ownedQuantity: ownedMaxedPi,
      isOwned: isMaxedPiOwned,
      incrementIndex: 1,
      isPassive: false,
      showRoi: true,
      bonus: {
        passive: false,
        frequency: 1,
        requirement: 1,
        description: "Airstrip free travels & +10 items capacity. +500 Max Happy training boost. Large Vault safety.",
      },
      roi: {
        cost: maxedPiCost,
        benefitType: "cash",
        itemName: "Airstrip & Training & Vault",
        benefitAmount: Math.round(maxedPiTotalUtility / 365),
        occurenceValue: Math.round(maxedPiTotalUtility / 365),
        annualYield: maxedPiFinancial,
        roiPercent: (maxedPiFinancial / maxedPiCost) * 100,
        incrementIndex: 1,
        sharesRequirement: 1,
        totalSharesAccumulated: 1,
        financialValue: maxedPiFinancial,
        gameplayValue: maxedPiGameplay,
        strategicValue: maxedPiStrategic,
        pesScore: maxedPiPes,
      },
    });

    // 6.7 Add virtual Stat Enhancers (SEs) with booster CD opportunity cost
    const seCost = 450000000;
    const totalStats = currentStrength + currentDefense + currentSpeed + currentDexterity;

    const statsList = [
      { id: "stat_enhancer_strength", name: "Boxing Gloves (Strength)", acronym: "SE (Strength)", statVal: currentStrength, targetRatio: targetStrRatio, logo: "https://www.torn.com/images/v2/items/large/368.png" },
      { id: "stat_enhancer_defense", name: "Dumbbells (Defense)", acronym: "SE (Defense)", statVal: currentDefense, targetRatio: targetDefRatio, logo: "https://www.torn.com/images/v2/items/large/369.png" },
      { id: "stat_enhancer_speed", name: "Skateboards (Speed)", acronym: "SE (Speed)", statVal: currentSpeed, targetRatio: targetSpdRatio, logo: "https://www.torn.com/images/v2/items/large/370.png" },
      { id: "stat_enhancer_dexterity", name: "Parachute (Dexterity)", acronym: "SE (Dexterity)", statVal: currentDexterity, targetRatio: targetDexRatio, logo: "https://www.torn.com/images/v2/items/large/371.png" },
    ];

    for (const se of statsList) {
      const statsGained = se.statVal * 0.01;
      const energySaved = statsGained / statsPerEnergy;
      const netEnergySaved = energySaved - 80; // 6h booster CD penalty is worth 80E
      const netCashValue = netEnergySaved > 0 ? netEnergySaved * 100000 : 0;

      const currentPct = totalStats > 0 ? (se.statVal / totalStats) * 100 : 25;
      const ratioWeight = currentPct > 0 ? Math.max(0.1, se.targetRatio / currentPct) : 1.0;

      // Consumable Liquidity Sunk Cost Penalty (0.5x multiplier)
      const seUtility = netCashValue * ratioWeight * 0.5;
      const sePes = seCost > 0 ? (seUtility / seCost) * 100 : 0;

      generatedIncrements.push({
        id: se.id,
        stock_id: 20000 + statsList.indexOf(se),
        name: se.name,
        acronym: se.acronym,
        logo: se.logo,
        full: null,
        price: 0,
        market_cap: 0,
        shares: 0,
        investors: 0,
        ownedQuantity: 0,
        isOwned: false,
        incrementIndex: 1,
        isPassive: false,
        showRoi: false,
        bonus: {
          passive: false,
          frequency: 1,
          requirement: 1,
          description: `adds ${statsGained.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${se.acronym.replace("SE (", "").replace(")", "")} • ${Math.round(netEnergySaved).toLocaleString()} E saved`,
        },
        roi: {
          cost: seCost,
          benefitType: "stats",
          itemName: se.acronym.replace("SE (", "").replace(")", ""),
          benefitAmount: statsGained,
          occurenceValue: seUtility,
          annualYield: 0,
          roiPercent: sePes,
          incrementIndex: 1,
          sharesRequirement: 1,
          totalSharesAccumulated: 1,
          financialValue: 0,
          gameplayValue: seUtility,
          strategicValue: 0,
          pesScore: sePes,
        },
      });
    }

    // 6.8 Add virtual Energy Cans dynamically
    const cansConfig = [
      { key: "can of munster", acronym: "Can (Munster)", energy: 20, defaultPrice: 1900000 },
      { key: "can of santa shooters", acronym: "Can (Santa Shooters)", energy: 20, defaultPrice: 1800000 },
      { key: "can of wild bull", acronym: "Can (Wild Bull)", energy: 25, defaultPrice: 2600000 },
      { key: "can of wired", acronym: "Can (Wired)", energy: 30, defaultPrice: 3600000 },
      { key: "can of red bull", acronym: "Can (Red Bull)", energy: 30, defaultPrice: 3500000 },
      { key: "can of x-mass", acronym: "Can (X-MASS)", energy: 30, defaultPrice: 3700000 },
    ];

    for (const can of cansConfig) {
      const dbPrice = itemPricesMap.get(can.key);
      const dbImage = itemImagesMap.get(can.key);
      
      const canPrice = dbPrice && dbPrice > 0 ? dbPrice : can.defaultPrice;
      const canImage = dbImage || "https://www.torn.com/images/v2/items/large/530.png";

      // 1 Can gives E, which trains stats:
      const statsGained = can.energy * statsPerEnergy;
      // Valuated at $8.25 per stat point gym training cap benchmark
      const grossUtility = statsGained * 8.25;
      // Apply Consumable Liquidity Sunk Cost Penalty (0.5x multiplier)
      const adjustedUtility = grossUtility * 0.5;
      const canPes = canPrice > 0 ? (adjustedUtility / canPrice) * 100 : 0;

      generatedIncrements.push({
        id: `can_${can.key.replace(/\s+/g, "_")}`,
        stock_id: 30000 + cansConfig.indexOf(can),
        name: can.key.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        acronym: can.acronym,
        logo: canImage,
        full: null,
        price: 0,
        market_cap: 0,
        shares: 0,
        investors: 0,
        ownedQuantity: 0,
        isOwned: false,
        incrementIndex: 1,
        isPassive: false,
        showRoi: false,
        bonus: {
          passive: false,
          frequency: 1,
          requirement: 1,
          description: `Consumable energy drink. Adds +${can.energy} Energy. Net stats gained: ${Math.round(statsGained).toLocaleString()} points.`,
        },
        roi: {
          cost: canPrice,
          benefitType: "stats",
          itemName: "Energy",
          benefitAmount: can.energy,
          occurenceValue: adjustedUtility,
          annualYield: 0,
          roiPercent: canPes,
          incrementIndex: 1,
          sharesRequirement: 1,
          totalSharesAccumulated: 1,
          financialValue: 0,
          gameplayValue: adjustedUtility,
          strategicValue: 0,
          pesScore: canPes,
        },
      });
    }

    // 7. Sort:
    // - Unowned first, with high-priority sorting overrides:
    //   - Recurring assets (showRoi === true) with ROI >= 25% are ALWAYS prioritized above consumables (SEs / Cans)
    //   - Otherwise, sort unowned items by PES Score descending
    // - Owned at the bottom
    generatedIncrements.sort((a, b) => {
      // 1. Owned goes to the very bottom
      if (a.isOwned && !b.isOwned) return 1;
      if (!a.isOwned && b.isOwned) return -1;
      if (a.isOwned && b.isOwned) {
        if (a.acronym !== b.acronym) return a.acronym.localeCompare(b.acronym);
        return a.incrementIndex - b.incrementIndex;
      }

      // Both are unowned:
      const isConsumableA = a.id.startsWith("stat_enhancer_") || a.id.startsWith("can_");
      const isConsumableB = b.id.startsWith("stat_enhancer_") || b.id.startsWith("can_");

      const hasHighRoiA = !isConsumableA && a.roi.roiPercent >= 25;
      const hasHighRoiB = !isConsumableB && b.roi.roiPercent >= 25;

      // Priority override: Recurring blocks (Stocks / PI) with ROI >= 25% always override Consumables
      if (hasHighRoiA && isConsumableB) return -1;
      if (isConsumableA && hasHighRoiB) return 1;

      // Default to PES Score sorting descending
      return b.roi.pesScore - a.roi.pesScore;
    });

    // 8. Fetch sync status of torn_stocks_worker
    const scheduleRow = await db
      .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .innerJoin(TABLE_NAMES.WORKERS, `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`, `${TABLE_NAMES.WORKERS}.id`)
      .select([
        `${TABLE_NAMES.WORKER_SCHEDULES}.last_run_at as last_run_at`,
        `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`
      ])
      .where(`${TABLE_NAMES.WORKERS}.name`, "=", "torn_stocks_worker")
      .executeTakeFirst();

    res.json({
      stocks: generatedIncrements,
      valuations: {
        points: valuationConfig.points,
        average_property_cost: valuationConfig.average_property_cost,
        source: {
          points: "Active points market price",
          average_property_cost: "Average cost of HRG properties pool"
        }
      },
      syncStatus: {
        lastSyncAt: scheduleRow?.last_run_at || null,
        nextRunAt: scheduleRow?.next_run_at || null
      }
    });
  } catch (error) {
    console.error("[HTTP] Error fetching stocks financials:", error);
    res.status(500).json({ error: "Server error" });
  }
});
