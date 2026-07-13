import { getItemValue, Logger, TornCrimes } from "@sentinel/shared";
import { type TornSchema, CrimeLedger } from "@sentinel/shared";

const logger = new Logger("crime_parser");

type CrimeData = {
  crime_action: string;
  nerve: number;
  money_gained?: number;
  items_gained?: Record<string, number>;
};

export function parseCrimes(log: TornSchema<"UserLog">): void {
  try {
    const data = log.data as unknown as CrimeData;
    if (!data.crime_action) return;

    const crimeId = getCrimeIdFromAction(data.crime_action);
    if (crimeId === 0) return;

    const base = CrimeLedger.findOne(crimeId.toString());
    if (!base) return;

    const crimeData = TornCrimes.findOne(crimeId.toString());
    if (!crimeData) return;

    const oldNerve = base.nerve_spent;
    const oldTotalValue = base.total_value;

    const currentNerveSpent = data.nerve;
    let currentTotalValue = 0;

    if (data.money_gained) {
      currentTotalValue += data.money_gained;
    }

    for (const [itemId, qty] of Object.entries(data.items_gained ?? {})) {
      currentTotalValue += qty * getItemValue(itemId);
    }

    // Insert incremental record
    CrimeLedger.update({
      id: crimeId.toString(),
      crime_name: crimeData.data.name,
      nerve_spent: currentNerveSpent + oldNerve,
      total_value: currentTotalValue + oldTotalValue,
    });
  } catch (error) {
    logger.error("Error parsing crime log:", error);
  }
}

function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (
    lower.includes("search") ||
    lower.includes("trash") ||
    lower.includes("subway") ||
    lower.includes("junkyard") ||
    lower.includes("beach") ||
    lower.includes("cemetery") ||
    lower.includes("fountain")
  ) {
    return 1;
  }
  if (
    lower.includes("dvd") ||
    lower.includes("bootleg") ||
    lower.includes("online store")
  ) {
    return 2;
  }
  if (lower.includes("graffiti")) {
    return 3;
  }
  if (lower.includes("shoplift")) {
    return 4;
  }
  if (lower.includes("pickpocket")) {
    return 5;
  }
  if (
    lower.includes("skim") ||
    lower.includes("skimming") ||
    lower.includes("atm")
  ) {
    return 6;
  }
  if (
    lower.includes("casing") ||
    lower.includes("burgle") ||
    lower.includes("burgling") ||
    lower.includes("scouting") ||
    lower.includes("burglary") ||
    lower.includes("brewery") ||
    lower.includes("truckyard") ||
    lower.includes("foundry")
  ) {
    return 7;
  }
  if (
    lower.includes("hustle") ||
    lower.includes("hustling") ||
    lower.includes("shell game") ||
    lower.includes("street hustle")
  ) {
    return 8;
  }
  if (
    lower.includes("dispose") ||
    lower.includes("disposal") ||
    lower.includes("body") ||
    lower.includes("discard")
  ) {
    return 9;
  }
  if (
    lower.includes("crack") ||
    lower.includes("cracking") ||
    lower.includes("safe") ||
    lower.includes("vault")
  ) {
    return 10;
  }
  if (
    lower.includes("forge") ||
    lower.includes("forgery") ||
    lower.includes("project") ||
    lower.includes("step #")
  ) {
    return 11;
  }
  if (lower.includes("scam") || lower.includes("spam")) {
    return 12;
  }
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
  ) {
    return 13;
  }
  return 0;
}
