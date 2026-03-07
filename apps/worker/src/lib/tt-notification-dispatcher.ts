/**
 * Territory Territories notification dispatcher
 * Sends TT notifications to Discord guilds via bot webhook
 */

import { TABLE_NAMES, type TornFactionData } from "@sentinel/shared";
import { logError } from "./logger.js";
import { getAllSystemApiKeys } from "./api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { getDB } from "@sentinel/shared/db/sqlite.js";

const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || "http://localhost:3001";

export interface TTEventNotification {
  guild_id: string;
  territory_id: string;
  event_type:
    | "assault_succeeded"
    | "assault_failed"
    | "dropped"
    | "claimed"
    | "desectored"
    | "war_started"
    | "war_ended"
    | "peace_treaty"
    | "racket_spawned"
    | "racket_despawned"
    | "racket_level_changed";
  assaulting_faction?: number;
  defending_faction?: number;
  occupying_faction: number | null;
  previous_faction?: number | null; // For "dropped" events - who abandoned it
  racket_name?: string;
  racket_old_level?: number;
  racket_new_level?: number;
  war_id?: number;
  victor_faction?: number;
  war_duration_hours?: number;
}

// In-memory cache for API key
let cachedSystemApiKey: string | null = null;

interface GuildConfigRow {
  guild_id: string;
  enabled_modules: string | null;
  tt_full_channel_id: string | null;
  tt_filtered_channel_id: string | null;
}

function parseEnabledModules(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => typeof entry === "string");
    }
  } catch {
    return [];
  }

  return [];
}

/**
 * Get a system API key for faction lookups (cached for dispatcher lifecycle)
 */
async function getApiKeyForDispatcher(): Promise<string | null> {
  if (cachedSystemApiKey) {
    return cachedSystemApiKey;
  }

  const apiKeys = await getAllSystemApiKeys("system");
  if (apiKeys.length > 0) {
    cachedSystemApiKey = apiKeys[0];
  }

  return cachedSystemApiKey;
}

/**
 * Get faction data using DB cache-first pattern
 * Falls back to API if not cached and API key available
 */
async function getFactionData(
  faction_id: number,
  apiKey: string | null,
): Promise<TornFactionData | null> {
  const db = getDB();
  const cached = db
    .prepare(
      `SELECT * FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id = ? LIMIT 1`,
    )
    .get(faction_id) as TornFactionData | undefined;

  if (cached) {
    return cached;
  }

  if (!apiKey) {
    return null;
  }

  try {
    const response = await tornApi.get("/faction/{id}/basic", {
      apiKey,
      pathParams: { id: faction_id },
    });

    const basic = response.basic;
    if (!basic) {
      return null;
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO "${TABLE_NAMES.TORN_FACTIONS}"
       (id, name, tag, tag_image, leader_id, co_leader_id, respect, days_old, capacity, members, is_enlisted, rank, best_chain, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         tag = excluded.tag,
         tag_image = excluded.tag_image,
         leader_id = excluded.leader_id,
         co_leader_id = excluded.co_leader_id,
         respect = excluded.respect,
         days_old = excluded.days_old,
         capacity = excluded.capacity,
         members = excluded.members,
         is_enlisted = excluded.is_enlisted,
         rank = excluded.rank,
         best_chain = excluded.best_chain,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    ).run(
      basic.id,
      basic.name,
      basic.tag,
      basic.tag_image,
      basic.leader_id,
      basic.co_leader_id,
      basic.respect,
      basic.days_old,
      basic.capacity,
      basic.members,
      basic.is_enlisted ? 1 : 0,
      basic.rank?.name || null,
      basic.best_chain,
      basic.note || null,
      now,
    );

    return db
      .prepare(
        `SELECT * FROM "${TABLE_NAMES.TORN_FACTIONS}" WHERE id = ? LIMIT 1`,
      )
      .get(faction_id) as TornFactionData | null;
  } catch {
    return null;
  }
}

function factionLink(name: string, id: number): string {
  return `[${name}](https://www.torn.com/factions.php?step=profile&ID=${id})`;
}

function territoryLink(territoryId: string): string {
  return `[${territoryId}](https://www.torn.com/city.php#terrName=${territoryId})`;
}

/**
 * Format territory list with commas and "and" for the last item
 */
function formatTerritoryList(territories: string[]): string {
  if (territories.length === 0) return "";
  if (territories.length === 1) return territoryLink(territories[0]);
  if (territories.length === 2)
    return `${territoryLink(territories[0])} & ${territoryLink(territories[1])}`;
  return (
    territories
      .slice(0, -1)
      .map((territory) => territoryLink(territory))
      .join(", ") +
    " & " +
    territoryLink(territories[territories.length - 1])
  );
}

/**
 * Format war duration from hours to "after X days Y hours at war"
 */
function formatWarDuration(hours: number): string {
  const days = Math.floor(hours / 24);
  const remainingHours = Math.floor(hours % 24);
  return `After ${days} ${days === 1 ? "day" : "days"} ${remainingHours} ${remainingHours === 1 ? "hour" : "hours"} at war`;
}

function formatFactionWithTerritoryCount(
  factionId: number,
  factionName: string,
  territoryCountsByFaction: Map<number, number>,
): string {
  const territoryCount = territoryCountsByFaction.get(factionId) ?? 0;
  return `${factionName} (${territoryCount})`;
}

async function getTerritoryCountsByFaction(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();

  const db = getDB();
  const rows = db
    .prepare(
      `SELECT faction_id FROM "${TABLE_NAMES.TERRITORY_STATE}" WHERE faction_id IS NOT NULL`,
    )
    .all() as Array<{ faction_id: number | null }>;

  for (const row of rows) {
    const factionId = Number(row.faction_id);
    if (!Number.isFinite(factionId)) {
      continue;
    }

    counts.set(factionId, (counts.get(factionId) || 0) + 1);
  }

  return counts;
}

/**
 * Build embeds for a group of notifications by faction and event type
 */
async function buildNotificationEmbeds(
  notifications: TTEventNotification[],
  apiKey: string | null,
  territoryCountsByFaction: Map<number, number>,
): Promise<Record<string, unknown>[]> {
  const embeds: Record<string, unknown>[] = [];

  // Group by faction and event type
  const groups = new Map<
    string,
    { faction_id: number | null; events: TTEventNotification[] }
  >();

  for (const notif of notifications) {
    let groupKey: string;
    let factionId: number | null = null;

    switch (notif.event_type) {
      case "claimed":
        groupKey = `${notif.event_type}:${notif.occupying_faction}`;
        factionId = notif.occupying_faction;
        break;
      case "dropped":
        groupKey = `${notif.event_type}:${notif.previous_faction}`;
        factionId = notif.previous_faction ?? null;
        break;
      case "assault_succeeded":
        groupKey = `${notif.event_type}:${notif.assaulting_faction}:${notif.defending_faction}`;
        factionId = notif.assaulting_faction ?? null;
        break;
      case "desectored":
        groupKey = `${notif.event_type}:${notif.previous_faction}`;
        factionId = notif.previous_faction ?? null;
        break;
      case "assault_failed":
        groupKey = `${notif.event_type}:${notif.assaulting_faction}:${notif.defending_faction}`;
        factionId = notif.defending_faction ?? null;
        break;
      case "war_started":
        groupKey = `${notif.event_type}:${notif.assaulting_faction}:${notif.defending_faction}`;
        factionId = notif.assaulting_faction ?? null;
        break;
      case "war_ended":
        groupKey = `${notif.event_type}:${notif.war_id}`;
        factionId = notif.victor_faction ?? null;
        break;
      case "peace_treaty":
        groupKey = `${notif.event_type}:${notif.assaulting_faction}:${notif.defending_faction}`;
        factionId = null; // No single faction for truce
        break;
      case "racket_spawned":
      case "racket_despawned":
      case "racket_level_changed":
        groupKey = `${notif.event_type}:${notif.territory_id}`;
        factionId = notif.occupying_faction;
        break;
      default:
        groupKey = `${notif.event_type}:${notif.territory_id}`;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { faction_id: factionId, events: [] });
    }
    groups.get(groupKey)!.events.push(notif);
  }

  // Build embeds for each group
  for (const [_groupKey, { faction_id, events }] of groups) {
    const firstEvent = events[0];
    const territories = events.map((e) => e.territory_id);
    const territoryList = formatTerritoryList(territories);

    let factionData: TornFactionData | null = null;
    if (faction_id) {
      factionData = await getFactionData(faction_id, apiKey);
    }

    const factionName = factionData?.name || `Faction ${faction_id}`;
    const factionNameWithCount = faction_id
      ? formatFactionWithTerritoryCount(
          faction_id,
          factionName,
          territoryCountsByFaction,
        )
      : factionName;
    const factionNameLinked = faction_id
      ? factionLink(factionNameWithCount, faction_id)
      : factionNameWithCount;

    switch (firstEvent.event_type) {
      case "claimed": {
        embeds.push({
          title: "Territory Claimed",
          description: `${factionNameLinked} claimed the sovereignty of ${territoryList}`,
          color: 0x0099ff, // Blue
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case "dropped": {
        embeds.push({
          title: "Territory Abandoned",
          description: `${factionNameLinked} abandoned ${territoryList}`,
          color: 0xffff00, // Yellow
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case "assault_succeeded": {
        const defenderData = await getFactionData(
          firstEvent.defending_faction || 0,
          apiKey,
        );
        const defenderName =
          defenderData?.name || `Faction ${firstEvent.defending_faction}`;
        const defenderNameWithCount = firstEvent.defending_faction
          ? formatFactionWithTerritoryCount(
              firstEvent.defending_faction,
              defenderName,
              territoryCountsByFaction,
            )
          : defenderName;
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderNameWithCount, firstEvent.defending_faction)
          : defenderNameWithCount;

        const embed: Record<string, unknown> = {
          title: "Assault Successful",
          description: `${factionNameLinked} successfully assaulted ${defenderNameLinked} and claimed the sovereignty of ${territoryList}`,
          color: 0x00ff00, // Green
          timestamp: new Date().toISOString(),
        };

        if (firstEvent.war_duration_hours !== undefined) {
          embed.footer = {
            text: formatWarDuration(firstEvent.war_duration_hours),
          };
        }

        embeds.push(embed);
        break;
      }

      case "desectored": {
        for (const notif of events) {
          let details = `${factionNameLinked} has become desectored after losing their last territory (${territoryLink(notif.territory_id)})`;

          if (notif.occupying_faction) {
            const newOwnerData = await getFactionData(
              notif.occupying_faction,
              apiKey,
            );
            const newOwnerName =
              newOwnerData?.name || `Faction ${notif.occupying_faction}`;
            const newOwnerNameWithCount = formatFactionWithTerritoryCount(
              notif.occupying_faction,
              newOwnerName,
              territoryCountsByFaction,
            );
            const newOwnerLinked = factionLink(
              newOwnerNameWithCount,
              notif.occupying_faction,
            );
            details = `${factionNameLinked} has become desectored after losing their last territory (${territoryLink(notif.territory_id)}) to ${newOwnerLinked}`;
          }

          embeds.push({
            title: "Faction Desectored",
            description: details,
            color: 0xc0392b,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case "assault_failed": {
        const attackerData = await getFactionData(
          firstEvent.assaulting_faction || 0,
          apiKey,
        );
        const attackerName =
          attackerData?.name || `Faction ${firstEvent.assaulting_faction}`;
        const attackerNameWithCount = firstEvent.assaulting_faction
          ? formatFactionWithTerritoryCount(
              firstEvent.assaulting_faction,
              attackerName,
              territoryCountsByFaction,
            )
          : attackerName;
        const attackerNameLinked = firstEvent.assaulting_faction
          ? factionLink(attackerNameWithCount, firstEvent.assaulting_faction)
          : attackerNameWithCount;

        embeds.push({
          title: "Assault Failed",
          description: `${attackerNameLinked} failed in its assault against ${factionNameLinked} over the sovereignty of ${territoryList}`,
          color: 0xff0000, // Red
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case "war_started": {
        const defenderData = await getFactionData(
          firstEvent.defending_faction || 0,
          apiKey,
        );
        const defenderName =
          defenderData?.name || `Faction ${firstEvent.defending_faction}`;
        const defenderNameWithCount = firstEvent.defending_faction
          ? formatFactionWithTerritoryCount(
              firstEvent.defending_faction,
              defenderName,
              territoryCountsByFaction,
            )
          : defenderName;
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderNameWithCount, firstEvent.defending_faction)
          : defenderNameWithCount;

        embeds.push({
          title: "Assault Begun",
          description: `${factionNameLinked} initiated an assault on ${defenderNameLinked} over the sovereignty of ${territoryList}`,
          color: 0xff6b00, // Orange
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case "peace_treaty": {
        const attackerData = await getFactionData(
          firstEvent.assaulting_faction || 0,
          apiKey,
        );
        const defenderData = await getFactionData(
          firstEvent.defending_faction || 0,
          apiKey,
        );
        const attackerName =
          attackerData?.name || `Faction ${firstEvent.assaulting_faction}`;
        const defenderName =
          defenderData?.name || `Faction ${firstEvent.defending_faction}`;
        const attackerNameWithCount = firstEvent.assaulting_faction
          ? formatFactionWithTerritoryCount(
              firstEvent.assaulting_faction,
              attackerName,
              territoryCountsByFaction,
            )
          : attackerName;
        const defenderNameWithCount = firstEvent.defending_faction
          ? formatFactionWithTerritoryCount(
              firstEvent.defending_faction,
              defenderName,
              territoryCountsByFaction,
            )
          : defenderName;
        const attackerNameLinked = firstEvent.assaulting_faction
          ? factionLink(attackerNameWithCount, firstEvent.assaulting_faction)
          : attackerNameWithCount;
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderNameWithCount, firstEvent.defending_faction)
          : defenderNameWithCount;

        const embed: Record<string, unknown> = {
          title: "Peace Treaty",
          description: `The territory war between ${attackerNameLinked} and ${defenderNameLinked} over the sovereignty of ${territoryList} has ended in a truce`,
          color: 0x808080, // Gray
          timestamp: new Date().toISOString(),
        };

        if (firstEvent.war_duration_hours !== undefined) {
          embed.footer = {
            text: formatWarDuration(firstEvent.war_duration_hours),
          };
        }

        embeds.push(embed);
        break;
      }

      case "racket_spawned": {
        for (const notif of events) {
          embeds.push({
            title: `Racket Spawned • ${notif.territory_id}`,
            description: `**${notif.racket_name}**`,
            fields: [
              {
                name: "Territory",
                value: territoryLink(notif.territory_id),
                inline: true,
              },
              {
                name: "Level",
                value: `Level ${notif.racket_new_level}`,
                inline: true,
              },
              {
                name: "Occupied by",
                value: factionNameLinked,
                inline: true,
              },
            ],
            color: 0x2ecc71, // Green
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case "racket_despawned": {
        for (const notif of events) {
          embeds.push({
            title: `Racket Vanished • ${notif.territory_id}`,
            description: `**${notif.racket_name}** (Level ${notif.racket_old_level}) • ${territoryLink(notif.territory_id)}`,
            color: 0xe74c3c, // Red
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case "racket_level_changed": {
        for (const notif of events) {
          const isLevelUp =
            (notif.racket_new_level ?? 0) > (notif.racket_old_level ?? 0);
          const title = isLevelUp
            ? `Racket Upgraded • ${notif.territory_id}`
            : `Racket Downgraded • ${notif.territory_id}`;
          const changeText = isLevelUp ? "leveled up" : "leveled down";

          embeds.push({
            title,
            description: `**${notif.racket_name}** ${changeText} from **Level ${notif.racket_old_level}** to **Level ${notif.racket_new_level}** • ${territoryLink(notif.territory_id)}`,
            fields: [
              {
                name: "Occupied by",
                value: factionNameLinked,
                inline: true,
              },
            ],
            color: isLevelUp ? 0xf39c12 : 0xe67e22,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }
    }
  }

  return embeds;
}

/**
 * Send embeds to a guild channel
 */
async function sendEmbedsToChannel(
  guildId: string,
  channelId: string,
  embeds: Record<string, unknown>[],
): Promise<void> {
  for (const embed of embeds) {
    const response = await fetch(`${BOT_WEBHOOK_URL}/send-guild-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId,
        channelId,
        embed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError(
        "TT Dispatcher",
        `Failed to send to guild ${guildId}: ${response.status} ${error}`,
      );
    }
  }
}

/**
 * Process multiple territory change notifications
 * Groups by faction and event type, then dispatches to guilds
 */
export async function processAndDispatchNotifications(
  notifications: TTEventNotification[],
): Promise<void> {
  if (notifications.length === 0) {
    return;
  }

  try {
    // Get API key for faction data lookups
    const apiKey = await getApiKeyForDispatcher();

    // Get guild configs for all guilds with TT module enabled
    const db = getDB();
    const guildConfigs = db
      .prepare(
        `SELECT guild_id, enabled_modules, tt_full_channel_id, tt_filtered_channel_id
         FROM "${TABLE_NAMES.GUILD_CONFIG}"`,
      )
      .all() as GuildConfigRow[];

    if (!guildConfigs || guildConfigs.length === 0) {
      return;
    }

    const ttEnabledGuilds = guildConfigs.filter((config) =>
      parseEnabledModules(config.enabled_modules).includes("territories"),
    );

    if (ttEnabledGuilds.length === 0) {
      return;
    }

    // Build embeds for all notifications
    const territoryCountsByFaction = await getTerritoryCountsByFaction();
    const embeds = await buildNotificationEmbeds(
      notifications,
      apiKey,
      territoryCountsByFaction,
    );

    // Send to each guild
    for (const config of ttEnabledGuilds) {
      if (config.tt_full_channel_id) {
        await sendEmbedsToChannel(
          config.guild_id,
          config.tt_full_channel_id,
          embeds,
        );
      }

      if (config.tt_filtered_channel_id) {
        // For now, send same notifications to filtered channel
        // In future, can add guild-specific filtering logic
        await sendEmbedsToChannel(
          config.guild_id,
          config.tt_filtered_channel_id,
          embeds,
        );
      }
    }
  } catch (error) {
    logError(
      "TT Dispatcher",
      `Error processing notifications: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
