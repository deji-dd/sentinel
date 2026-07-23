export interface RewardInfo {
  amount: number;
  type: "cash" | "items" | "points";
  itemName?: string;
  displayString: string;
}

export function parseRewardString(
  rewardOrString: string | { type: string; quantity: number; id: number | null } | null | undefined,
  itemNames: Record<string, string> = {},
): RewardInfo | null {
  if (!rewardOrString) return null;

  if (typeof rewardOrString === "object") {
    const typeMap: Record<string, "cash" | "items" | "points"> = {
      Money: "cash",
      Points: "points",
      Item: "items",
    };
    const type = typeMap[rewardOrString.type] || "cash";
    const idStr = rewardOrString.id ? String(rewardOrString.id) : undefined;
    const resolvedName = idStr && itemNames[idStr] ? itemNames[idStr] : rewardOrString.type;
    
    let displayString = `${rewardOrString.quantity.toLocaleString()}x ${resolvedName} daily`;
    if (type === "cash") {
      displayString = `$${rewardOrString.quantity.toLocaleString()} daily`;
    }

    return {
      amount: rewardOrString.quantity,
      type,
      itemName: idStr,
      displayString,
    };
  }

  const rewardString = String(rewardOrString);

  const cashMatch = rewardString.match(/^\$([0-9,]+)\s+daily$/);
  if (cashMatch) {
    const amount = parseInt(cashMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(amount)) {
      return { amount, type: "cash", displayString: rewardString };
    }
  }

  const pointsMatch = rewardString.match(/^([0-9,]+)x\s+Points\s+daily$/i);
  if (pointsMatch) {
    const amount = parseInt(pointsMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(amount)) {
      return { amount, type: "points", itemName: "Points", displayString: rewardString };
    }
  }

  const itemsMatch = rewardString.match(/^([0-9,]+)x\s+(.+)\s+daily$/i);
  if (itemsMatch) {
    const amount = parseInt(itemsMatch[1].replace(/,/g, ""), 10);
    const itemName = itemsMatch[2].trim();
    if (!Number.isNaN(amount)) {
      return { amount, type: "items", itemName, displayString: rewardString };
    }
  }

  return null;
}

export function calculateDailyValue(
  reward: RewardInfo | null,
  prices: Record<string, number> = {},
): number {
  if (!reward) return 0;
  if (reward.type === "cash") return reward.amount;
  const unitPrice = prices[reward.itemName || ""] || 0;
  return reward.amount * unitPrice;
}
