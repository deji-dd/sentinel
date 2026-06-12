/**
 * Territory war tracking helpers
 * Provides live data fetch and embed building for tracked wars
 */

import { EmbedBuilder, Client } from "discord.js";
import { getFactionNameCached, TABLE_NAMES, type TornApiComponents } from "@sentinel/shared";
import { tornApi } from "../services/torn-client.js";
import { db } from "./db-client.js";
import { getGuildApiKeys } from "./guild-api-keys.js";

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
        name: "Territory",
        value: `[${display.territoryId}](${territoryUrl})`,
        inline: true,
      },
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

  // Torn API v2 returns members as an array: [{ "id": 123, "name": "...", "position": "..." }, ... ]
  const members = (factionMembersResponse.members || []) as (FactionMember & {
    id: number;
  })[];

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
    (await getFactionNameCached(war.assaulting_faction, tornApi, apiKey)) ||
    `Faction ${war.assaulting_faction}`;
  const defendingName =
    (await getFactionNameCached(war.defending_faction, tornApi, apiKey)) ||
    `Faction ${war.defending_faction}`;

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

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const apiKeys = await getGuildApiKeys(guildId);
  return apiKeys.length > 0 ? apiKeys[0] : null;
}

function buildEndedEmbed(territoryId: string): EmbedBuilder {
  const territoryUrl = `https://www.torn.com/city.php#terrName=${territoryId}`;
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`${territoryId} War Ended`)
    .setDescription("This war is no longer active. Tracking disabled.")
    .addFields({
      name: "Territory",
      value: `[${territoryId}](${territoryUrl})`,
      inline: true,
    });
}

async function updateTrackerMessage(
  client: Client,
  tracker: WarTrackerRecord,
  war: TerritoryWarWithTerritory,
  assaultingName: string,
  defendingName: string,
  assaultingFactionId: number,
  defendingFactionId: number,
  enemyUsers: string[],
): Promise<void> {
  if (!tracker.channel_id) {
    return;
  }

  const channel = await client.channels
    .fetch(tracker.channel_id)
    .catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    return;
  }

  const embed = buildWarTrackerEmbed(war, {
    assaultingName,
    defendingName,
    assaultingFactionId,
    defendingFactionId,
    enemySide: tracker.enemy_side,
    enemyUsers,
    minAwayMinutes: tracker.min_away_minutes,
    territoryId: tracker.territory_id,
    lastUpdated: new Date(),
  });

  if (tracker.message_id) {
    const message = await channel.messages
      .fetch(tracker.message_id)
      .catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed] }).catch(() => {});
      return;
    }
  }

  const newMessage = await channel
    .send({ embeds: [embed] })
    .catch(() => null);
  if (newMessage) {
    await db
      .updateTable(TABLE_NAMES.WAR_TRACKERS)
      .set({
        message_id: newMessage.id,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", tracker.guild_id)
      .where("war_id", "=", tracker.war_id)
      .execute();
  }
}

async function handleWarEnded(tracker: WarTrackerRecord, client: Client): Promise<void> {
  if (!tracker.channel_id || !tracker.message_id) {
    await db
      .updateTable(TABLE_NAMES.WAR_TRACKERS)
      .set({
        channel_id: null,
        message_id: null,
        updated_at: new Date().toISOString(),
      })
      .where("guild_id", "=", tracker.guild_id)
      .where("war_id", "=", tracker.war_id)
      .execute();
    return;
  }

  const channel = await client.channels
    .fetch(tracker.channel_id)
    .catch(() => null);
  if (channel && channel.isTextBased()) {
    const message = await channel.messages
      .fetch(tracker.message_id)
      .catch(() => null);
    if (message) {
      await message.edit({
        embeds: [buildEndedEmbed(tracker.territory_id)],
      });
    }
  }

  await db
    .updateTable(TABLE_NAMES.WAR_TRACKERS)
    .set({
      channel_id: null,
      message_id: null,
      updated_at: new Date().toISOString(),
    })
    .where("guild_id", "=", tracker.guild_id)
    .where("war_id", "=", tracker.war_id)
    .execute();
}

export async function runWarTrackerGuildSync(
  client: Client,
  guildId: string,
): Promise<void> {
  const trackers = (await db
    .selectFrom(TABLE_NAMES.WAR_TRACKERS)
    .select([
      "guild_id",
      "war_id",
      "territory_id",
      "channel_id",
      "message_id",
      "enemy_side",
      "min_away_minutes",
    ])
    .where("guild_id", "=", guildId)
    .where("channel_id", "is not", null)
    .execute()) as WarTrackerRecord[];

  if (trackers.length === 0) {
    return;
  }

  const apiKey = await getActiveApiKey(guildId);
  if (!apiKey) {
    return;
  }

  const warMap = await fetchActiveTerritoryWars(apiKey);

  for (const tracker of trackers) {
    const war = warMap.get(tracker.war_id);
    if (!war) {
      await handleWarEnded(tracker, client);
      continue;
    }

    const assaultingName =
      (await getFactionNameCached(war.assaulting_faction, tornApi, apiKey)) ||
      `Faction ${war.assaulting_faction}`;
    const defendingName =
      (await getFactionNameCached(war.defending_faction, tornApi, apiKey)) ||
      `Faction ${war.defending_faction}`;

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

    await updateTrackerMessage(
      client,
      tracker,
      war,
      assaultingName,
      defendingName,
      war.assaulting_faction,
      war.defending_faction,
      enemyUsers,
    );
  }
}
