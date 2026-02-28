/**
 * Territory burn logic for assault eligibility checks
 * Shared between assault-check command and burn-map visualizations
 */

export interface WarRecord {
  war_id: number;
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  victor_faction: number | null;
  start_time: string;
  end_time: string | null;
}

export interface BurnCheckResult {
  territoryId: string;
  canAssault: boolean;
  reasons: string[];
  hoursRemaining?: number;
}

/**
 * Check if a faction can assault a specific territory based on war history
 * Returns detailed result with reasons if territory is burned
 */
export function checkTerritoryBurn(
  territoryId: string,
  factionId: number,
  wars: WarRecord[],
  currentTerritoryCount: number,
): BurnCheckResult {
  const result: BurnCheckResult = {
    territoryId: territoryId.toUpperCase(),
    canAssault: true,
    reasons: [],
  };

  const territoryWars = wars.filter(
    (w) => w.territory_id === territoryId.toUpperCase(),
  );

  if (territoryWars.length === 0) {
    // No war history means can assault
    return result;
  }

  // Check if faction lost on this territory in last 72 hours
  const factionsWarOnThis = territoryWars.filter(
    (w) =>
      (w.assaulting_faction === factionId ||
        w.defending_faction === factionId) &&
      w.victor_faction !== factionId,
  );

  if (factionsWarOnThis.length > 0) {
    const lastLossOnThis = factionsWarOnThis[0];
    const timeSinceLoss =
      Date.now() - new Date(lastLossOnThis.start_time).getTime();
    const lossTrigger = 72 * 60 * 60 * 1000;

    if (timeSinceLoss < lossTrigger) {
      const hoursRemaining = Math.ceil(
        (lossTrigger - timeSinceLoss) / (60 * 60 * 1000),
      );
      result.canAssault = false;
      result.hoursRemaining = hoursRemaining;
      result.reasons.push(
        `Lost war on this territory: ${hoursRemaining}h remaining`,
      );
    }
  }

  // Check 90-day rule: if faction has warred this territory in last 90 days,
  // must wait 72h after ANY war on this territory (even by other factions)
  const factionWarsOnThisTerritory = territoryWars.filter(
    (w) =>
      w.assaulting_faction === factionId || w.defending_faction === factionId,
  );

  if (factionWarsOnThisTerritory.length > 0) {
    // Faction has warred this territory in last 90 days
    // Check if ANY faction has warred this territory in last 72 hours
    const lastWarOnThis = territoryWars[0]; // Most recent war by ANY faction
    const timeSinceAnyWar =
      Date.now() - new Date(lastWarOnThis.start_time).getTime();
    const waitTrigger = 72 * 60 * 60 * 1000;

    if (timeSinceAnyWar < waitTrigger) {
      const hoursRemaining = Math.ceil(
        (waitTrigger - timeSinceAnyWar) / (60 * 60 * 1000),
      );
      result.canAssault = false;
      result.hoursRemaining = Math.max(
        result.hoursRemaining || 0,
        hoursRemaining,
      );
      result.reasons.push(
        `90-day rule: Recent war by any faction (${hoursRemaining}h remaining)`,
      );
    }
  }

  return result;
}

/**
 * Get all territories that a faction cannot assault (burned territories)
 * Returns array of territory IDs that are currently on cooldown
 */
export function getBurnedTerritories(
  factionId: number,
  allTerritories: string[],
  wars: WarRecord[],
  currentTerritoryCount: number,
): string[] {
  const burnedTerritories: string[] = [];

  for (const territoryId of allTerritories) {
    const result = checkTerritoryBurn(
      territoryId,
      factionId,
      wars,
      currentTerritoryCount,
    );

    if (!result.canAssault) {
      burnedTerritories.push(territoryId);
    }
  }

  return burnedTerritories;
}

/**
 * Check if faction is under global 72h cooldown for Sector 7 claiming
 * (applies when faction has 0 territories and recently lost one)
 */
export function checkSector7Cooldown(
  factionId: number,
  wars: WarRecord[],
  currentTerritoryCount: number,
): { isOnCooldown: boolean; hoursRemaining?: number } {
  if (currentTerritoryCount > 0) {
    return { isOnCooldown: false };
  }

  const factionWarsDef = wars.filter(
    (w) =>
      (w.defending_faction === factionId ||
        w.assaulting_faction === factionId) &&
      w.victor_faction !== factionId,
  );

  if (factionWarsDef.length === 0) {
    return { isOnCooldown: false };
  }

  const lastLoss = factionWarsDef[0]; // Most recent loss first
  const lossTrigger = 72 * 60 * 60 * 1000; // 72 hours
  const timeSinceLoss = Date.now() - new Date(lastLoss.start_time).getTime();

  if (timeSinceLoss < lossTrigger) {
    const hoursRemaining = Math.ceil(
      (lossTrigger - timeSinceLoss) / (60 * 60 * 1000),
    );
    return { isOnCooldown: true, hoursRemaining };
  }

  return { isOnCooldown: false };
}
