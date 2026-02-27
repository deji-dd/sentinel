/**
 * Territory war tracking helpers
 * Provides live data fetch and embed building for tracked wars
 */

import { EmbedBuilder } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { botTornApi } from "./torn-api.js";
import { getFactionNameCached } from "@sentinel/shared";
import type { TornApiClient } from "@sentinel/shared";

export interface TerritoryWar {
  territory_war_id: number;
  assaulting_faction: number;
  defending_faction: number;
  score: number;
  required_score: number;
  started: number;
  ends: number;
  assaulters: number[];
  defenders: number[];
}

export interface TerritoryWarWithTerritory extends TerritoryWar {
  territory_id: string;
}

export interface WarTrackerRecord {
  guild_id: string;
  war_id: number;
  territory_id: string;
  channel_id: string | null;
  message_id: string | null;
  enemy_side: "assaulting" | "defending";
  min_away_minutes: number;
}

interface TornV1TerritorywarsResponse {
  territorywars: Record<string, TerritoryWar>;
}

export interface WarTrackerDisplayData {
  assaultingName: string;
  defendingName: string;
  enemySide: "assaulting" | "defending";
  enemyUsers: string[];
  minAwayMinutes: number;
  territoryId: string;
}

export async function fetchActiveTerritoryWars(
  apiKey: string,
  apiClient: TornApiClient = botTornApi,
): Promise<Map<number, TerritoryWarWithTerritory>> {
  const result = new Map<number, TerritoryWarWithTerritory>();
  const response = await apiClient.getRaw("/torn", apiKey, {
    selections: "territorywars",
  });

  if ("error" in response) {
    return result;
  }

  const data = response as unknown as TornV1TerritorywarsResponse;
  const warEntries = Object.entries(data.territorywars || {});

  for (const [territoryCode, war] of warEntries) {
    result.set(war.territory_war_id, {
      ...war,
      territory_id: territoryCode,
    });
  }

  return result;
}

export function buildWarTrackerEmbed(
  war: TerritoryWarWithTerritory,
  display: WarTrackerDisplayData,
): EmbedBuilder {
  const enemyLabel =
    display.enemySide === "assaulting"
      ? `Assaulting: ${display.assaultingName}`
      : `Defending: ${display.defendingName}`;

  const enemyUsersText =
    display.enemyUsers.length > 0
      ? display.enemyUsers.join("\n")
      : display.minAwayMinutes > 0
        ? "No wall users meet the away filter"
        : "No enemy users on the wall";

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`⚔️ ${display.territoryId} Territory War`)
    .addFields(
      {
        name: "Score",
        value: `${war.score}/${war.required_score}`,
        inline: true,
      },
      {
        name: "Ends",
        value: `<t:${war.ends}:R>`,
        inline: true,
      },
      {
        name: "Enemy Side",
        value: enemyLabel,
        inline: false,
      },
      {
        name: "Enemy Wall",
        value: enemyUsersText,
        inline: false,
      },
    );
}

export async function resolveEnemyUsers(
  apiKey: string,
  enemyFactionId: number,
  enemyIds: number[],
  minAwayMinutes: number,
  apiClient: TornApiClient = botTornApi,
): Promise<string[]> {
  const factionMembersResponse = await apiClient.get("/faction/{id}/members", {
    apiKey,
    pathParams: { id: String(enemyFactionId) },
  });

  if ("error" in factionMembersResponse) {
    return [];
  }

  const members = factionMembersResponse.members || [];
  const enemyIdSet = new Set(enemyIds);
  const filtered = members.filter((member) => {
    if (!member.is_on_wall) {
      return false;
    }

    if (!enemyIdSet.has(member.id)) {
      return false;
    }

    if (minAwayMinutes <= 0) {
      return true;
    }

    const awayMinutes = Math.floor(
      (Date.now() - member.last_action.timestamp * 1000) / 60000,
    );
    return awayMinutes >= minAwayMinutes;
  });

  return filtered.map((member) => {
    const awayMinutes = Math.max(
      0,
      Math.floor((Date.now() - member.last_action.timestamp * 1000) / 60000),
    );
    return `${member.name} (${awayMinutes}m)`;
  });
}

export async function fetchTrackerData(
  supabase: SupabaseClient,
  tracker: WarTrackerRecord,
  apiKey: string,
  apiClient: TornApiClient = botTornApi,
): Promise<{
  war: TerritoryWarWithTerritory | null;
  assaultingName: string;
  defendingName: string;
  enemyUsers: string[];
} | null> {
  const warsMap = await fetchActiveTerritoryWars(apiKey, apiClient);
  const war = warsMap.get(tracker.war_id);
  if (!war) {
    return null;
  }

  const assaultingName =
    (await getFactionNameCached(
      supabase,
      war.assaulting_faction,
      apiClient,
      apiKey,
    )) || `Faction ${war.assaulting_faction}`;
  const defendingName =
    (await getFactionNameCached(
      supabase,
      war.defending_faction,
      apiClient,
      apiKey,
    )) || `Faction ${war.defending_faction}`;

  const enemyFactionId =
    tracker.enemy_side === "assaulting"
      ? war.assaulting_faction
      : war.defending_faction;
  const enemyIds =
    tracker.enemy_side === "assaulting" ? war.assaulters : war.defenders;

  const enemyUsers = await resolveEnemyUsers(
    apiKey,
    enemyFactionId,
    enemyIds,
    tracker.min_away_minutes,
    apiClient,
  );

  return { war, assaultingName, defendingName, enemyUsers };
}
