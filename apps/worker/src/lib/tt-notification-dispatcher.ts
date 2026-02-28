/**
 * Territory Territories notification dispatcher
 * Sends TT notifications to Discord guilds via bot webhook
 */

import {
  TABLE_NAMES,
  getFactionDataCached,
  type TornFactionData,
} from "@sentinel/shared";
import { supabase } from "./supabase.js";
import { logError } from "./logger.js";
import { getAllSystemApiKeys } from "./api-keys.js";
import { tornApi } from "../services/torn-client.js";

const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || "http://localhost:3001";

export interface TTEventNotification {
  guild_id: string;
  territory_id: string;
  event_type:
    | "assault_succeeded"
    | "assault_failed"
    | "dropped"
    | "claimed"
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

/**
 * Get a system API key for faction lookups (cached for dispatcher lifecycle)
 */
async function getApiKeyForDispatcher(): Promise<string | null> {
  if (cachedSystemApiKey) {
    return cachedSystemApiKey;
  }

  const apiKeys = await getAllSystemApiKeys("all");
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
  if (!apiKey) {
    // Try DB only
    const { data: cached } = await supabase
      .from(TABLE_NAMES.TORN_FACTIONS)
      .select("*")
      .eq("id", faction_id)
      .maybeSingle();

    return cached as TornFactionData | null;
  }

  // Use shared function with cache-first, API fallback
  return getFactionDataCached(supabase, faction_id, tornApi, apiKey);
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

/**
 * Build embeds for a group of notifications by faction and event type
 */
async function buildNotificationEmbeds(
  notifications: TTEventNotification[],
  apiKey: string | null,
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
      case "assault_failed":
        groupKey = `${notif.event_type}:${notif.defending_faction}:${notif.assaulting_faction}`;
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
    const factionNameLinked = faction_id
      ? factionLink(factionName, faction_id)
      : factionName;

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
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderName, firstEvent.defending_faction)
          : defenderName;

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

      case "assault_failed": {
        const attackerData = await getFactionData(
          firstEvent.assaulting_faction || 0,
          apiKey,
        );
        const attackerName =
          attackerData?.name || `Faction ${firstEvent.assaulting_faction}`;
        const attackerNameLinked = firstEvent.assaulting_faction
          ? factionLink(attackerName, firstEvent.assaulting_faction)
          : attackerName;

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
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderName, firstEvent.defending_faction)
          : defenderName;

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
        const attackerNameLinked = firstEvent.assaulting_faction
          ? factionLink(attackerName, firstEvent.assaulting_faction)
          : attackerName;
        const defenderNameLinked = firstEvent.defending_faction
          ? factionLink(defenderName, firstEvent.defending_faction)
          : defenderName;

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
          embeds.push({
            title: `Racket Upgraded • ${notif.territory_id}`,
            description: `**${notif.racket_name}** leveled up from **Level ${notif.racket_old_level}** to **Level ${notif.racket_new_level}** • ${territoryLink(notif.territory_id)}`,
            fields: [
              {
                name: "Occupied by",
                value: factionNameLinked,
                inline: true,
              },
            ],
            color: 0xf39c12, // Gold
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
    const { data: guildConfigs } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select(
        "guild_id, enabled_modules, tt_full_channel_id, tt_filtered_channel_id",
      );

    if (!guildConfigs || guildConfigs.length === 0) {
      return;
    }

    const ttEnabledGuilds = guildConfigs.filter((config) =>
      (config.enabled_modules as string[] | null)?.includes("territories"),
    );

    if (ttEnabledGuilds.length === 0) {
      return;
    }

    // Build embeds for all notifications
    const embeds = await buildNotificationEmbeds(notifications, apiKey);

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
