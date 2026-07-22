import { getItemValue } from "../database/functions/get-item-value.js";
import { CrimeActivity } from "../database/index.js";

import { CrimeActionMappings } from "../database/schemas/user/crime-ledger.js";

/**
 * Maps a real-time Crime action string from the Torn API log
 * to its corresponding Crime ID via the DB mapping.
 * Unmapped actions are saved as 0 to be flagged.
 */
export function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (!lower) return 0;

  const existing = CrimeActionMappings.findOne(lower);
  if (existing) {
    // If it's explicitly mapped to 0 (unmapped) or a valid ID, use it.
    // This allows users to remap something even if regex would have caught it incorrectly.
    return existing.crime_id;
  }

  let resolvedId = 0;
  if (
    lower.includes("search") ||
    lower.includes("trash") ||
    lower.includes("subway") ||
    lower.includes("junkyard") ||
    lower.includes("beach") ||
    lower.includes("cemetery") ||
    lower.includes("fountain")
  ) {
    resolvedId = 1;
  } else if (
    lower.includes("dvd") ||
    lower.includes("bootleg") ||
    lower.includes("online store")
  ) {
    resolvedId = 2;
  } else if (lower.includes("graffiti")) {
    resolvedId = 3;
  } else if (lower.includes("shoplift")) {
    resolvedId = 4;
  } else if (lower.includes("pickpocket")) {
    resolvedId = 5;
  } else if (
    lower.includes("skim") ||
    lower.includes("atm") ||
    lower.includes("gas pump") ||
    lower.includes("train station") ||
    lower.includes("subway") ||
    lower.includes("cash register")
  ) {
    resolvedId = 6;
  } else if (
    lower.includes("burgle") ||
    lower.includes("burgling") ||
    lower.includes("burglary") ||
    lower.includes("casing") ||
    lower.includes("scouting for an industrial burglary") ||
    lower.includes("brewery") ||
    lower.includes("truckyard") ||
    lower.includes("foundry")
  ) {
    resolvedId = 7;
  } else if (
    lower.includes("hustle") ||
    lower.includes("hustling") ||
    lower.includes("shell game") ||
    lower.includes("street hustle")
  ) {
    resolvedId = 8;
  } else if (
    lower.includes("dispose") ||
    lower.includes("disposal") ||
    lower.includes("body") ||
    lower.includes("discard")
  ) {
    resolvedId = 9;
  } else if (
    lower.includes("crack") ||
    lower.includes("cracking") ||
    lower.includes("safe") ||
    lower.includes("vault")
  ) {
    resolvedId = 10;
  } else if (
    lower.includes("forge") ||
    lower.includes("forgery") ||
    lower.includes("project") ||
    lower.includes("step #")
  ) {
    resolvedId = 11;
  } else if (lower.includes("scam") || lower.includes("spam")) {
    resolvedId = 12;
  } else if (
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
  ) {
    resolvedId = 13;
  }

  try {
    CrimeActionMappings.insertOne({
      id: lower,
      action: lower,
      crime_id: resolvedId,
    });
  } catch (e) {
    // Ignore UNIQUE constraint errors if it somehow races
  }

  return resolvedId;
}

/**
 * Calculates the total net monetary value from a real-time Crime log's data payload.
 * Accurately tracks both gains and critical failure losses.
 */
export function calculateCrimeLogValue(data: CrimeActivity): number {
  let total = 0;

  // 1. Process Fiat Additions and Deductions
  if (data.money_gained) {
    total += data.money_gained;
  }
  if (data.money_lost) {
    total -= data.money_lost;
  }

  // 2. Process Item Additions
  for (const [itemId, qty] of Object.entries(data.items_gained ?? {})) {
    total += qty * getItemValue(itemId);
  }

  // 3. Process Item Deductions
  for (const [itemId, qty] of Object.entries(data.items_lost ?? {})) {
    total -= qty * getItemValue(itemId);
  }

  return total;
}
