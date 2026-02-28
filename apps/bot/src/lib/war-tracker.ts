/**
 * Territory war tracking helpers
 * Provides live data fetch and embed building for tracked wars
 */

import { EmbedBuilder } from "discord.js";
import { supabase } from "./supabase.js";
import { getFactionNameCached, type TornApiComponents } from "@sentinel/shared";
import { tornApi } from "../services/torn-client.js";

type FactionMember = TornApiComponents["schemas"]["FactionMember"];

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
  assaultingFactionId: number;
  defendingFactionId: number;
  enemySide: "assaulting" | "defending";
  enemyUsers: string[];
  minAwayMinutes: number;
  territoryId: string;
  lastUpdated?: Date;
}

export async function fetchActiveTerritoryWars(
  apiKey: string,
): Promise<Map<number, TerritoryWarWithTerritory>> {
  const result = new Map<number, TerritoryWarWithTerritory>();
  const response = await tornApi.getRaw("/torn", apiKey, {
    selections: "territorywars",
  });

  if ("error" in response) {
    return result;
  }

  const data = response as TornV1TerritorywarsResponse;
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
  const territoryUrl = `https://www.torn.com/city.php#terrName=${display.territoryId}`;

  const assaultingFactionUrl = `https://www.torn.com/factions.php?step=profile&ID=${display.assaultingFactionId}`;
  const defendingFactionUrl = `https://www.torn.com/factions.php?step=profile&ID=${display.defendingFactionId}`;

  const enemyLabel =
    display.enemySide === "assaulting"
      ? `Assaulting: [${display.assaultingName}](${assaultingFactionUrl})`
      : `Defending: [${display.defendingName}](${defendingFactionUrl})`;

  let enemyUsersText: string;
  if (display.enemyUsers.length === 0) {
    enemyUsersText =
      display.minAwayMinutes > 0
        ? "No wall users meet the away filter"
        : "No enemy users on the wall";
  } else {
    // Discord field value max is 1024 chars, truncate if needed
    const MAX_FIELD_LENGTH = 1024;
    let truncated = false;
    let usersToShow = display.enemyUsers;

    while (
      usersToShow.join("\n").length > MAX_FIELD_LENGTH &&
      usersToShow.length > 1
    ) {
      usersToShow = usersToShow.slice(0, -1);
      truncated = true;
    }

    enemyUsersText = usersToShow.join("\n");
    if (truncated) {
      const remaining = display.enemyUsers.length - usersToShow.length;
      enemyUsersText += `\n\n_...and ${remaining} more_`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`${display.territoryId} Territory War`)
    .setDescription(`[View Territory](${territoryUrl})`)
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
        name: `Enemy Wall (${display.enemyUsers.length})`,
        value: enemyUsersText,
        inline: false,
      },
    );

  if (display.lastUpdated) {
    embed.setFooter({ text: `Last updated` });
    embed.setTimestamp(display.lastUpdated);
  }

  return embed;
}

export async function resolveEnemyUsers(
  apiKey: string,
  enemyFactionId: number,
  enemyIds: number[],
  minAwayMinutes: number,
): Promise<string[]> {
  const factionMembersResponse = await tornApi.get("/faction/{id}/members", {
    apiKey,
    pathParams: { id: String(enemyFactionId) },
  });

  if ("error" in factionMembersResponse) {
    return [];
  }

  const members: FactionMember[] = factionMembersResponse.members || [];
  const enemyIdSet = new Set(enemyIds);
  const filtered = members.filter((member) => {
    if (!member.is_on_wall) {
      return false;
    }

    if (!enemyIdSet.has(member.id)) {
      return false;
    }

    // Only include players with "Okay" status (exclude Hospital, Jail, etc.)
    if (member.status.state !== "Okay") {
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

  // Sort by descending away time (longest away first)
  const sorted = filtered.sort((a, b) => {
    const aAway = Date.now() - a.last_action.timestamp * 1000;
    const bAway = Date.now() - b.last_action.timestamp * 1000;
    return bAway - aAway;
  });

  return sorted.map((member) => {
    const awaySeconds = Math.max(
      0,
      Math.floor((Date.now() - member.last_action.timestamp * 1000) / 1000),
    );

    let timeStr: string;
    if (awaySeconds < 60) {
      timeStr = `${awaySeconds}s`;
    } else if (awaySeconds < 3600) {
      const minutes = Math.floor(awaySeconds / 60);
      timeStr = `${minutes}m`;
    } else {
      const hours = Math.floor(awaySeconds / 3600);
      timeStr = `${hours}h`;
    }

    const profileUrl = `https://www.torn.com/profiles.php?XID=${member.id}`;
    const attackUrl = `https://www.torn.com/loader.php?sid=attack&user2ID=${member.id}`;

    return `[${member.name}](${profileUrl})  ·  ${timeStr}  ·  [Attack](${attackUrl})`;
  });
}

export async function fetchTrackerData(
  tracker: WarTrackerRecord,
  apiKey: string,
): Promise<{
  war: TerritoryWarWithTerritory | null;
  assaultingName: string;
  defendingName: string;
  enemyUsers: string[];
} | null> {
  const warsMap = await fetchActiveTerritoryWars(apiKey);
  const war = warsMap.get(tracker.war_id);
  if (!war) {
    return null;
  }

  const assaultingName =
    (await getFactionNameCached(
      supabase,
      war.assaulting_faction,
      tornApi,
      apiKey,
    )) || `Faction ${war.assaulting_faction}`;
  const defendingName =
    (await getFactionNameCached(
      supabase,
      war.defending_faction,
      tornApi,
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
  );

  return { war, assaultingName, defendingName, enemyUsers };
}
