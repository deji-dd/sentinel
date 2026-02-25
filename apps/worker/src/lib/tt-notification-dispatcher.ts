/**
 * Territory Territories notification dispatcher
 * Sends TT notifications to Discord guilds via bot webhook with batching support
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "./supabase.js";
import { log, logError } from "./logger.js";

const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || "http://localhost:3001";

interface TTEventNotification {
  guild_id: string;
  territory_id: string;
  event_type: "assault_succeeded" | "assault_failed" | "dropped" | "claimed";
  assaulting_faction?: number;
  defending_faction?: number;
  occupying_faction: number | null;
}

interface TTEventBatch {
  guild_id: string;
  channel_id: string;
  notifications: TTEventNotification[];
}

/**
 * Build embed JSON for single TT event notification
 */
function buildTTEventEmbed(
  notification: TTEventNotification,
): Record<string, unknown> {
  const baseEmbed = {
    title: `Territory ${notification.territory_id}`,
    timestamp: new Date().toISOString(),
  };

  switch (notification.event_type) {
    case "assault_succeeded":
      return {
        ...baseEmbed,
        color: 0x00ff00, // Green
        description: `🎯 Assault Succeeded\n\nAssaulting Faction: **${notification.assaulting_faction}**\nDefending Faction: **${notification.defending_faction}**\nNew Owner: **${notification.occupying_faction}**`,
      };

    case "assault_failed":
      return {
        ...baseEmbed,
        color: 0xff0000, // Red
        description: `❌ Assault Failed\n\nAssaulting Faction: **${notification.assaulting_faction}**\nDefending Faction: **${notification.defending_faction}**\nOwner Maintained: **${notification.occupying_faction}**`,
      };

    case "dropped":
      return {
        ...baseEmbed,
        color: 0xffff00, // Yellow
        description: `📦 Territory Dropped\n\nPrevious Owner: Faction ${notification.occupying_faction ? notification.occupying_faction : "Unknown"}\nNow: Uncontrolled`,
      };

    case "claimed":
      return {
        ...baseEmbed,
        color: 0x0099ff, // Blue
        description: `🚩 Territory Claimed\n\nNew Owner: **${notification.occupying_faction}**`,
      };

    default:
      return {
        ...baseEmbed,
        color: 0x808080,
        description: "Unknown event type",
      };
  }
}

/**
 * Build batch summary embed for multiple TT events
 * Groups events by type for better readability
 */
function buildBatchSummaryEmbed(batch: TTEventBatch): Record<string, unknown> {
  const eventsByType = batch.notifications.reduce(
    (acc, notif) => {
      if (!acc[notif.event_type]) {
        acc[notif.event_type] = [];
      }
      acc[notif.event_type].push(notif);
      return acc;
    },
    {} as Record<string, TTEventNotification[]>,
  );

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  // Add summaries for each event type
  if (eventsByType.assault_succeeded) {
    fields.push({
      name: "🎯 Assaults Succeeded",
      value: eventsByType.assault_succeeded
        .map(
          (n) =>
            `${n.territory_id} (${n.assaulting_faction} → ${n.occupying_faction})`,
        )
        .join("\n"),
      inline: true,
    });
  }

  if (eventsByType.assault_failed) {
    fields.push({
      name: "❌ Assaults Failed",
      value: eventsByType.assault_failed
        .map((n) => `${n.territory_id} (${n.defending_faction} defended)`)
        .join("\n"),
      inline: true,
    });
  }

  if (eventsByType.dropped) {
    fields.push({
      name: "📦 Dropped",
      value: eventsByType.dropped.map((n) => n.territory_id).join(", "),
      inline: false,
    });
  }

  if (eventsByType.claimed) {
    fields.push({
      name: "🚩 Claimed",
      value: eventsByType.claimed
        .map((n) => `${n.territory_id} (Faction ${n.occupying_faction})`)
        .join("\n"),
      inline: false,
    });
  }

  const embed: Record<string, unknown> = {
    title: `🌍 Territory Update Batch`,
    description: `${batch.notifications.length} territory change(s)`,
    color: 0x3b82f6,
    fields: fields,
    timestamp: new Date().toISOString(),
    footer: {
      text: "Batch notification",
    },
  };

  return embed;
}

/**
 * Send TT event notification to guild channel (individual)
 */
export async function dispatchTTNotification(
  notification: TTEventNotification,
  channelId: string,
): Promise<boolean> {
  try {
    const embed = buildTTEventEmbed(notification);

    const response = await fetch(`${BOT_WEBHOOK_URL}/send-guild-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: notification.guild_id,
        channelId: channelId,
        embed: embed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(
        `[TT Dispatcher] Failed to send notification: ${response.status} ${error}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("[TT Dispatcher] Error dispatching notification:", error);
    return false;
  }
}

/**
 * Send batch TT event notifications to guild channel
 * Combines multiple territory changes into a single summary embed
 */
export async function dispatchTTBatch(batch: TTEventBatch): Promise<boolean> {
  try {
    const embed = buildBatchSummaryEmbed(batch);

    const response = await fetch(`${BOT_WEBHOOK_URL}/send-guild-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: batch.guild_id,
        channelId: batch.channel_id,
        embed: embed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError(
        "TT Dispatcher",
        `Failed to send batch notification: ${response.status} ${error}`,
      );
      return false;
    }

    log(
      "TT Dispatcher",
      `Sent batch (${batch.notifications.length} events) to guild ${batch.guild_id}`,
    );
    return true;
  } catch (error) {
    logError(
      "TT Dispatcher",
      `Error dispatching batch notification: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Check if guild should be notified about this TT change
 */
function shouldNotifyGuild(
  config: {
    tt_territory_ids?: string[];
    tt_faction_ids?: number[];
  },
  event: TTEventNotification,
): boolean {
  const territoryIds = config.tt_territory_ids || [];
  const factionIds = config.tt_faction_ids || [];

  if (territoryIds.length === 0 && factionIds.length === 0) {
    return false;
  }

  const territoryMatches = territoryIds.includes(event.territory_id);
  if (territoryMatches) {
    return true;
  }

  if (factionIds.length === 0) {
    return false;
  }

  const relevantFactions = [
    event.occupying_faction,
    event.assaulting_faction,
    event.defending_faction,
  ].filter((f) => f !== undefined && f !== null);

  return relevantFactions.some((f) => factionIds.includes(f));
}

/**
 * Check if guild has any filtered notification configuration
 */
function hasFilteredConfig(config: {
  tt_territory_ids?: string[];
  tt_faction_ids?: number[];
}): boolean {
  return (
    (config.tt_territory_ids?.length || 0) > 0 ||
    (config.tt_faction_ids?.length || 0) > 0
  );
}

/**
 * Process and dispatch notifications as batches per guild
 * All territory changes for a guild are sent as a single summary embed
 */
export async function processAndDispatchNotifications(
  notifications: TTEventNotification[],
): Promise<void> {
  if (notifications.length === 0) {
    return;
  }

  try {
    // Get all guilds with TT module enabled
    const { data: guilds } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select(
        "guild_id, enabled_modules, tt_full_channel_id, tt_filtered_channel_id, tt_territory_ids, tt_faction_ids",
      );

    if (!guilds || guilds.length === 0) {
      log("TT Dispatcher", "No guilds with TT module enabled");
      return;
    }

    const ttEnabledGuilds = guilds.filter((g) =>
      g.enabled_modules?.includes("territories"),
    );

    if (ttEnabledGuilds.length === 0) {
      log("TT Dispatcher", "No guilds have territories module enabled");
      return;
    }

    console.log(
      `[TT Dispatcher] Processing batch notifications for ${ttEnabledGuilds.length} guilds`,
    );

    // For each guild, fetch TT config and filter notifications
    for (const guild of ttEnabledGuilds) {
      const ttConfig = {
        tt_full_channel_id: guild.tt_full_channel_id as string | null,
        tt_filtered_channel_id: guild.tt_filtered_channel_id as string | null,
        tt_territory_ids: (guild.tt_territory_ids as string[]) || [],
        tt_faction_ids: (guild.tt_faction_ids as number[]) || [],
      };

      if (ttConfig.tt_full_channel_id) {
        const batch: TTEventBatch = {
          guild_id: guild.guild_id,
          channel_id: ttConfig.tt_full_channel_id,
          notifications: notifications,
        };

        await dispatchTTBatch(batch);
      }

      if (ttConfig.tt_filtered_channel_id && hasFilteredConfig(ttConfig)) {
        const filteredNotifications = notifications.filter((n) =>
          shouldNotifyGuild(ttConfig, n),
        );

        if (filteredNotifications.length === 0) {
          continue;
        }

        const batch: TTEventBatch = {
          guild_id: guild.guild_id,
          channel_id: ttConfig.tt_filtered_channel_id,
          notifications: filteredNotifications,
        };

        await dispatchTTBatch(batch);
      }
    }
  } catch (error) {
    console.error(
      "[TT Dispatcher] Error processing batch notifications:",
      error,
    );
  }
}
