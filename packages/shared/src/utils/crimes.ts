import { getItemValue } from "../database/functions/get-item-value.js";

/**
 * Maps a real-time Crime action string from the Torn API log
 * to its corresponding Crime ID.
 */
export function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (
    lower.includes("search") ||
    lower.includes("trash") ||
    lower.includes("subway") ||
    lower.includes("junkyard") ||
    lower.includes("beach") ||
    lower.includes("cemetery") ||
    lower.includes("fountain")
  )
    return 1;
  if (
    lower.includes("dvd") ||
    lower.includes("bootleg") ||
    lower.includes("online store")
  )
    return 2;
  if (lower.includes("graffiti")) return 3;
  if (lower.includes("shoplift")) return 4;
  if (lower.includes("pickpocket")) return 5;
  if (
    lower.includes("skim") ||
    lower.includes("atm") ||
    lower.includes("gas pump") ||
    lower.includes("train station") ||
    lower.includes("subway") ||
    lower.includes("cash register") // actually some overlap, but matches legacy logic
  )
    return 6;
  if (
    lower.includes("burgle") ||
    lower.includes("burglary") ||
    lower.includes("brewery") ||
    lower.includes("truckyard") ||
    lower.includes("foundry")
  )
    return 7;
  if (
    lower.includes("hustle") ||
    lower.includes("hustling") ||
    lower.includes("shell game") ||
    lower.includes("street hustle")
  )
    return 8;
  if (
    lower.includes("dispose") ||
    lower.includes("disposal") ||
    lower.includes("body") ||
    lower.includes("discard")
  )
    return 9;
  if (
    lower.includes("crack") ||
    lower.includes("cracking") ||
    lower.includes("safe") ||
    lower.includes("vault")
  )
    return 10;
  if (
    lower.includes("forge") ||
    lower.includes("forgery") ||
    lower.includes("project") ||
    lower.includes("step #")
  )
    return 11;
  if (lower.includes("scam") || lower.includes("spam")) return 12;
  if (
    lower.includes("rob") ||
    lower.includes("robbery") ||
    lower.includes("inquire") ||
    lower.includes("make entry") ||
    lower.includes("plant evidence") ||
    lower.includes("place combustible") ||
    lower.includes("ignite fire") ||
    lower.includes("stoke fire") ||
    lower.includes("dampen fire") ||
    lower.includes("collect")
  )
    return 13;
  return 0;
}

export type CrimeLogData = {
  crime_action: string;
  nerve: number;
  money_gained?: number;
  items_gained?: Record<string, number>;
};

/**
 * Calculates the total monetary value from a real-time Crime log's data payload.
 */
export function calculateCrimeLogValue(data: CrimeLogData): number {
  let total = 0;
  if (data.money_gained) {
    total += data.money_gained;
  }
  for (const [itemId, qty] of Object.entries(data.items_gained ?? {})) {
    total += qty * getItemValue(itemId);
  }
  return total;
}
