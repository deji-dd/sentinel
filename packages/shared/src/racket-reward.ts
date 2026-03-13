/**
 * Racket reward tracking and calculation utilities
 * Handles parsing reward descriptions and calculating accumulated rewards
 */

export interface RewardInfo {
  amount: number;
  type: "cash" | "items" | "points";
  displayString: string;
}

/**
 * Parse racket reward string into components
 * Examples:
 * - "$80,000,000 daily" → { amount: 80000000, type: "cash" }
 * - "160x Bottle of Moonshine daily" → { amount: 160, type: "items" }
 * - "4,000x Points daily" → { amount: 4000, type: "points" }
 */
export function parseRewardString(
  rewardString: string | null | undefined,
): RewardInfo | null {
  if (!rewardString) {
    return null;
  }

  // Try to match cash format: "$X,XXX,XXX daily"
  const cashMatch = rewardString.match(/^\$([0-9,]+)\s+daily$/);
  if (cashMatch) {
    const amount = parseInt(cashMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(amount)) {
      return {
        amount,
        type: "cash",
        displayString: rewardString,
      };
    }
  }

  // Try to match points format: "X,XXXx Points daily"
  const pointsMatch = rewardString.match(/^([0-9,]+)x\s+Points\s+daily$/i);
  if (pointsMatch) {
    const amount = parseInt(pointsMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(amount)) {
      return {
        amount,
        type: "points",
        displayString: rewardString,
      };
    }
  }

  // Try to match items format: "XXXx ItemName daily"
  const itemsMatch = rewardString.match(/^([0-9,]+)x\s+.+\s+daily$/i);
  if (itemsMatch) {
    const amount = parseInt(itemsMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(amount)) {
      return {
        amount,
        type: "items",
        displayString: rewardString,
      };
    }
  }

  return null;
}

/**
 * Calculate total accumulated reward for a tenure
 * @param reward The reward description string
 * @param startedAt Unix timestamp (seconds) when faction acquired the racket
 * @param endedAt Unix timestamp (seconds) when faction lost the racket (or now)
 * @returns Formatted accumulated reward string, or null if can't parse
 */
export function calculateAccumulatedReward(
  reward: string | null | undefined,
  startedAt: number,
  endedAt: number | null,
): { value: string; days: number } | null {
  const rewardInfo = parseRewardString(reward);
  if (!rewardInfo) {
    return null;
  }

  const endTime = endedAt || Math.floor(Date.now() / 1000);

  // Torn pays racket rewards at 00:00 UTC. Count how many UTC midnight
  // boundaries are inside the ownership window [startedAt, endTime).
  const daysHeld = countUtcMidnightPayouts(startedAt, endTime);
  const totalAccumulated = rewardInfo.amount * daysHeld;

  let formattedValue: string;
  if (rewardInfo.type === "cash") {
    formattedValue = `$${totalAccumulated.toLocaleString()}`;
  } else if (rewardInfo.type === "points") {
    formattedValue = `${totalAccumulated.toLocaleString()} Points`;
  } else {
    // items - show as "XXXx Items" for simplicity
    formattedValue = `${totalAccumulated.toLocaleString()}x Items`;
  }

  return {
    value: formattedValue,
    days: daysHeld,
  };
}

function countUtcMidnightPayouts(startedAt: number, endedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 0;
  }

  if (endedAt <= startedAt) {
    return 0;
  }

  const SECONDS_PER_DAY = 86400;
  const firstPayoutAt =
    Math.ceil(startedAt / SECONDS_PER_DAY) * SECONDS_PER_DAY;

  // Window is [startedAt, endedAt): payout at endedAt itself is not earned.
  if (firstPayoutAt >= endedAt) {
    return 0;
  }

  const lastIncluded = endedAt - 1;
  return Math.floor((lastIncluded - firstPayoutAt) / SECONDS_PER_DAY) + 1;
}

/**
 * Format accumulated reward for display
 * @returns String like "$50,000,000 (5 days)" or null if can't calculate
 */
export function formatAccumulatedReward(
  reward: string | null | undefined,
  startedAt: number,
  endedAt: number | null,
): string | null {
  const accumulated = calculateAccumulatedReward(reward, startedAt, endedAt);
  if (!accumulated) {
    return null;
  }

  return `${accumulated.value} (${accumulated.days} day${accumulated.days === 1 ? "" : "s"})`;
}

/**
 * Strips level suffix (Roman numerals) from a racket name to get the base identifier
 * Example: "Money Launderer III" -> "Money Launderer"
 */
export function getRacketBaseName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  // Matches a space followed by Roman numerals at the end of the string (Levels I-V)
  return name.replace(/\s+(I|II|III|IV|V)$/i, "").trim();
}
