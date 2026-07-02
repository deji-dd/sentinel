export interface StockBenefitInfo {
  type: "cash" | "items" | "points" | "stats" | "passive";
  amount: number;
  itemName?: string;
  isPassive: boolean;
}

export interface StockRoiAnalysis {
  cost: number;
  benefitType: "cash" | "items" | "points" | "stats" | "passive";
  itemName?: string;
  benefitAmount?: number;
  occurenceValue: number;
  annualYield: number; // raw cash yield
  roiPercent: number; // raw ROI

  // PES Model metrics
  financialValue: number; // annual cash value
  gameplayValue: number; // annual gameplay utility (E, N, WSU, etc)
  strategicValue: number; // annual strategic necessity (Vault, time saving)
  pesScore: number; // Progression Efficiency Score (Utility / Cost * 100)
}

export interface StockIncrementAnalysis extends StockRoiAnalysis {
  incrementIndex: number;
  sharesRequirement: number;
  totalSharesAccumulated: number;
}

/**
 * Parses stock bonus description into structured benefit information.
 */
export function parseStockBenefit(
  description: string | null | undefined,
  passive: boolean | number
): StockBenefitInfo {
  const isPassive = Number(passive) === 1;
  if (!description) {
    return { type: "passive", amount: 0, isPassive: true };
  }

  if (isPassive) {
    return { type: "passive", amount: 0, isPassive: true };
  }

  const cleanDesc = description.trim();

  // 1. Cash: e.g. "$50,000,000"
  const cashMatch = cleanDesc.match(/^\$([0-9,]+)$/);
  if (cashMatch) {
    return {
      type: "cash",
      amount: parseInt(cashMatch[1].replace(/,/g, ""), 10),
      isPassive: false,
    };
  }

  // 2. Items: e.g. "1x Box of Medical Supplies"
  const itemMatch = cleanDesc.match(/^(\d+)x\s+(.+)$/);
  if (itemMatch) {
    return {
      type: "items",
      amount: parseInt(itemMatch[1], 10),
      itemName: itemMatch[2].trim(),
      isPassive: false,
    };
  }

  // 3. Points: e.g. "100 points"
  const pointsMatch = cleanDesc.match(/^([0-9,]+)\s+points$/i);
  if (pointsMatch) {
    return {
      type: "points",
      amount: parseInt(pointsMatch[1].replace(/,/g, ""), 10),
      itemName: "Points",
      isPassive: false,
    };
  }

  // 4. Stats: e.g. "100 energy", "1000 happiness", "50 nerve"
  const statsMatch = cleanDesc.match(/^([0-9,]+)\s+(energy|nerve|happiness)$/i);
  if (statsMatch) {
    const type = statsMatch[2].toLowerCase();
    return {
      type: "stats",
      amount: parseInt(statsMatch[1].replace(/,/g, ""), 10),
      itemName: type.charAt(0).toUpperCase() + type.slice(1),
      isPassive: false,
    };
  }

  // Fallback to passive/unknown
  return {
    type: "passive",
    amount: 0,
    isPassive: true,
  };
}

export interface ValuationConfig {
  points?: number;
  average_property_cost?: number;
}

/**
 * Calculates PES and ROI for a stock increment.
 */
export function calculateStockIncrementROI(
  stock: {
    acronym?: string;
    price: number;
    bonus_requirement: number;
    bonus_frequency: number;
    bonus_description: string;
    bonus_passive: boolean | number;
  },
  itemPrices: Map<string, number>,
  incrementIndex: number = 1,
  valuation: ValuationConfig = {}
): StockIncrementAnalysis {
  const price = stock.price;
  const baseRequirement = stock.bonus_requirement;
  const frequency = stock.bonus_frequency;
  const description = stock.bonus_description;
  const passive = stock.bonus_passive;

  const isPassive = Number(passive) === 1;
  const costMultiplier = isPassive ? 1 : Math.pow(2, incrementIndex - 1);
  
  let totalSharesAccumulated = baseRequirement;
  if (!isPassive) {
    totalSharesAccumulated = 0;
    for (let i = 1; i <= incrementIndex; i++) {
      totalSharesAccumulated += baseRequirement * Math.pow(2, i - 1);
    }
  }

  const sharesRequirement = isPassive ? baseRequirement : baseRequirement * costMultiplier;
  const cost = sharesRequirement * price;
  const benefit = parseStockBenefit(description, passive);

  // Valuation defaults
  const pPrice = valuation.points ?? 31000;
  const propPrice = valuation.average_property_cost ?? 8100000;

  let occurenceValue = 0;
  let financialValue = 0;
  let gameplayValue = 0;
  let strategicValue = 0;

  // 1. Resolve raw cash yield & financial value
  if (benefit.type === "cash") {
    occurenceValue = benefit.amount;
    financialValue = frequency > 0 ? occurenceValue * (365 / frequency) : 0;
  } else if (benefit.type === "items" && benefit.itemName) {
    const nameLower = benefit.itemName.toLowerCase();
    if (nameLower === "random property") {
      occurenceValue = benefit.amount * propPrice;
    } else {
      const itemVal = itemPrices.get(nameLower) ?? 0;
      occurenceValue = benefit.amount * itemVal;
    }
    financialValue = frequency > 0 ? occurenceValue * (365 / frequency) : 0;
  } else if (benefit.type === "points") {
    occurenceValue = benefit.amount * pPrice;
    financialValue = frequency > 0 ? occurenceValue * (365 / frequency) : 0;
  }

  // 2. Resolve stat & gameplay utility value (Energy, Nerve)
  if (benefit.type === "stats" && benefit.itemName) {
    const statName = benefit.itemName.toLowerCase();
    const annualMultiplier = frequency > 0 ? 365 / frequency : 0;
    if (statName === "energy") {
      // 1 Energy is valued at $3,000 training utility
      gameplayValue = benefit.amount * annualMultiplier * 3000;
    } else if (statName === "nerve") {
      // 1 Nerve is valued at $2,500 crime/progression utility
      gameplayValue = benefit.amount * annualMultiplier * 2500;
    }
  }

  // 3. Resolve passive benefits gameplay & strategic values
  if (isPassive && stock.acronym) {
    const ticker = stock.acronym.toUpperCase();
    if (ticker === "TCI") {
      // TCI (+10% bank interest bonus). Assumes max 2B bank, yielding $160M interest boost per year
      financialValue = 160000000;
    } else if (ticker === "WSU") {
      // WSU (10% education course time reduction). Crucial for early stats/unlocks.
      gameplayValue = 20000000;
    } else if (ticker === "IST") {
      // IST (Free education courses). Saves time/fees.
      gameplayValue = 15000000;
    } else if (ticker === "WLT") {
      // WLT (Private jet travel). Free travel fees saved ($32M/yr) + strategic jet speed (-30% flight time)
      gameplayValue = 32000000;
      strategicValue = 50000000;
    } else if (ticker === "TCP" || ticker === "TGP") {
      // TCP/TGP (Company sales/advertising boosts)
      gameplayValue = 10000000;
    } else if (ticker === "IIL") {
      // IIL (Coding time reduction)
      gameplayValue = 5000000;
    } else {
      // Placeholder value for other utility passives
      gameplayValue = 2000000;
    }
  }

  const annualYield = financialValue; // keep annualYield as cash return for ROI calculation
  const roiPercent = cost > 0 ? (annualYield / cost) * 100 : 0;

  // 4. Calculate Progression Efficiency Score (PES)
  // PES = (Financial Value + Gameplay Utility + Strategic Necessity) / Cost * 100
  const totalUtility = financialValue + gameplayValue + strategicValue;
  const pesScore = cost > 0 ? (totalUtility / cost) * 100 : 0;

  return {
    cost,
    benefitType: benefit.type,
    itemName: benefit.itemName,
    benefitAmount: benefit.amount,
    occurenceValue,
    annualYield,
    roiPercent,
    incrementIndex,
    sharesRequirement,
    totalSharesAccumulated,
    financialValue,
    gameplayValue,
    strategicValue,
    pesScore,
  };
}

/**
 * Backwards compatibility wrapper for calculateStockROI.
 */
export function calculateStockROI(
  stock: {
    price: number;
    bonus_requirement: number;
    bonus_frequency: number;
    bonus_description: string;
    bonus_passive: boolean | number;
  },
  itemPrices: Map<string, number>,
  valuation: ValuationConfig = {}
): StockRoiAnalysis {
  return calculateStockIncrementROI(stock, itemPrices, 1, valuation);
}
