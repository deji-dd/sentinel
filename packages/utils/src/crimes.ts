/**
 * Maps a crime action string to its numeric Crime ID (1-13) matching Torn Crimes 2.0.
 */
export function getCrimeIdFromAction(action: string): number {
  const lower = action.toLowerCase().trim();
  if (!lower) return 0;

  if (
    lower.includes("search") ||
    lower.includes("trash") ||
    lower.includes("junkyard") ||
    lower.includes("cemetery") ||
    lower.includes("fountain")
  ) {
    return 1;
  } else if (
    lower.includes("dvd") ||
    lower.includes("bootleg") ||
    lower.includes("online store")
  ) {
    return 2;
  } else if (lower.includes("graffiti")) {
    return 3;
  } else if (lower.includes("shoplift")) {
    return 4;
  } else if (lower.includes("pickpocket")) {
    return 5;
  } else if (
    lower.includes("skim") ||
    lower.includes("atm") ||
    lower.includes("gas pump") ||
    lower.includes("train station") ||
    lower.includes("cash register")
  ) {
    return 6;
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
    return 7;
  } else if (
    lower.includes("hustle") ||
    lower.includes("hustling") ||
    lower.includes("shell game") ||
    lower.includes("street hustle")
  ) {
    return 8;
  } else if (
    lower.includes("dispose") ||
    lower.includes("disposal") ||
    lower.includes("discard") ||
    lower.includes("abandoning") ||
    lower.includes("burying") ||
    lower.includes("vehicle") ||
    lower.includes("sinking")
  ) {
    return 9;
  } else if (
    lower.includes("crack") ||
    lower.includes("cracking") ||
    lower.includes("safe") ||
    lower.includes("vault") ||
    lower.includes("brute force") ||
    lower.includes("brute forcing") ||
    lower.includes("password") ||
    lower.includes("encryption") ||
    lower.includes("hash")
  ) {
    return 10;
  } else if (
    lower.includes("rob") ||
    lower.includes("robbery") ||
    lower.includes("inquire") ||
    lower.includes("make entry") ||
    lower.includes("plant evidence") ||
    lower.includes("planting evidence") ||
    lower.includes("place combustible") ||
    lower.includes("ignite fire") ||
    lower.includes("stoke fire") ||
    lower.includes("dampen fire") ||
    lower.includes("collect") ||
    lower.includes("breaching") ||
    lower.includes("combustible") ||
    lower.includes("igniting") ||
    lower.includes("dampening") ||
    lower.includes("stoking") ||
    lower.includes("arson") ||
    lower.includes("fire")
  ) {
    return 13;
  } else if (
    lower.includes("forge") ||
    lower.includes("forgery") ||
    lower.includes("project") ||
    lower.includes("step #") ||
    lower.includes("drafting") ||
    lower.includes("signing") ||
    lower.includes("laminating") ||
    lower.includes("cutting") ||
    lower.includes("perforating") ||
    lower.includes("painting") ||
    lower.includes("trimming") ||
    lower.includes("stacking & folding") ||
    lower.includes("sewing") ||
    lower.includes("gluing") ||
    lower.includes("embossing")
  ) {
    return 11;
  } else if (lower.includes("scam") || lower.includes("spam")) {
    return 12;
  }

  return 0;
}

/**
 * Safely extracts inner crime log action and nerve data regardless of object nesting.
 */
export function extractCrimeDataPayload(raw: any): {
  action: string;
  nerve: number;
  innerData: any;
} {
  if (!raw) return { action: "", nerve: 0, innerData: null };
  const inner = raw.data || raw;
  const action = String(inner.crime_action || raw.crime_action || "").trim();
  const nerve = Number(inner.nerve || raw.nerve || 0);
  return { action, nerve, innerData: inner };
}

/**
 * Calculates net monetary value gained/lost in a crime event payload.
 */
export function calculateCrimeLogValue(data: any): number {
  if (!data) return 0;
  let total = 0;

  if (data.money_gained) total += Number(data.money_gained);
  if (data.money_lost) total -= Number(data.money_lost);

  if (data.items_gained && typeof data.items_gained === "object") {
    for (const [, qty] of Object.entries(data.items_gained)) {
      total += Number(qty || 0) * 1000;
    }
  }

  if (data.items_lost && typeof data.items_lost === "object") {
    for (const [, qty] of Object.entries(data.items_lost)) {
      total -= Number(qty || 0) * 1000;
    }
  }

  return total;
}
