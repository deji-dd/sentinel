/**
 * Energy Dashboard task
 * Updates personal dashboard embeds in Discord channels configured by the user.
 */

import { Client, EmbedBuilder } from "discord.js";
import { db } from "../lib/db-client.js";
import { Logger } from "../lib/logger.js";
import { TABLE_NAMES } from "@sentinel/shared";

const logger = new Logger("EnergyDashboard");
const TASK_NAME = "energy_dashboard";
let taskInFlight = false;

export async function performEnergyDashboardSync(client: Client): Promise<void> {
  if (taskInFlight) {
    return;
  }

  taskInFlight = true;
  const startTime = Date.now();

  try {
    const userId = process.env.SENTINEL_USER_ID;
    if (!userId) {
      throw new Error("SENTINEL_USER_ID environment variable not set");
    }

    // 1. Fetch personal settings for the user
    const personalSettings = await db
      .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS)
      .selectAll()
      .where("user_id", "=", String(userId))
      .executeTakeFirst();

    if (!personalSettings) {
      logger.info("No personal settings found, skipping energy dashboard sync");
      return;
    }

    // Check if any dashboard channels are configured
    const hasAnyDashboard =
      personalSettings.energy_dashboard_rec_channel_id ||
      personalSettings.energy_dashboard_target_channel_id ||
      personalSettings.energy_dashboard_graph_channel_id ||
      personalSettings.energy_dashboard_gains_channel_id;

    if (!hasAnyDashboard) {
      return;
    }

    // 2. Fetch system personal API key for Torn API calls
    let apiKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
    try {
      const keyRow = await db
        .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
        .select("api_key_encrypted")
        .where("key_type", "=", "personal")
        .where("is_primary", "=", 1)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      
      if (keyRow?.api_key_encrypted && process.env.ENCRYPTION_KEY) {
        const { decryptApiKey } = await import("@sentinel/shared");
        apiKey = decryptApiKey(keyRow.api_key_encrypted, process.env.ENCRYPTION_KEY);
      }
    } catch (err) {
      logger.error("Failed to decrypt personal API key:", err);
    }

    // Helper to update/create Discord messages
    const updateOrCreateMessage = async (
      channelId: string,
      messageId: string | null,
      embed: EmbedBuilder,
      dbFieldName: string
    ): Promise<string | null> => {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          logger.error(`Channel ${channelId} not found or not text-based`);
          return messageId;
        }

        let message = null;
        if (messageId) {
          message = await channel.messages.fetch(messageId).catch(() => null);
        }

        if (message) {
          await message.edit({ embeds: [embed] });
          return messageId;
        } else {
          const sentMessage = await channel.send({ embeds: [embed] });
          // Update database with the new message ID
          await db
            .updateTable(TABLE_NAMES.PERSONAL_SETTINGS)
            .set({ [dbFieldName]: sentMessage.id })
            .where("user_id", "=", userId)
            .execute();
          logger.info(`Created new dashboard message in channel ${channelId} and updated ${dbFieldName} to ${sentMessage.id}`);
          return sentMessage.id;
        }
      } catch (error) {
        logger.error(`Failed to update or create dashboard message in channel ${channelId}:`, error);
        return messageId;
      }
    };

    // --- 3. Process Display 1: Training Recommendation ---
    if (personalSettings.energy_dashboard_rec_channel_id) {
      try {
        const { getPersonalTrainingRecommendations } = await import("@sentinel/shared/training-recommendations.js");
        const recs = await getPersonalTrainingRecommendations(db, userId, apiKey);

        const embedRec = new EmbedBuilder()
          .setColor(0x7289da) // blue
          .setTitle("Energy - Training Recommendation")
          .addFields(
            { name: "Optimal Stat to Train", value: recs.stat, inline: true },
            { name: "Active Gym", value: recs.activeGymName, inline: true },
            { name: "Current Energy", value: `${recs.currentEnergy} / ${recs.maxEnergy} E`, inline: true },
            { name: "Recommendation", value: recs.text, inline: false }
          )
          .setTimestamp();

        if (recs.gymRecommendation) {
          embedRec.addFields({ name: "Gym Advice", value: recs.gymRecommendation, inline: false });
        }

        await updateOrCreateMessage(
          personalSettings.energy_dashboard_rec_channel_id,
          personalSettings.energy_dashboard_rec_message_id,
          embedRec,
          "energy_dashboard_rec_message_id"
        );
      } catch (err) {
        logger.error("Failed to sync Training Recommendation display:", err);
      }
    }

    // --- 4. Process Display 2: Stats to Target ---
    if (personalSettings.energy_dashboard_target_channel_id) {
      try {
        const statsRow = await db
          .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst();

        const build = personalSettings.selected_build || "balanced";
        const targets = {
          strength: personalSettings.target_strength_ratio !== undefined ? Number(personalSettings.target_strength_ratio) : 25,
          defense: personalSettings.target_defense_ratio !== undefined ? Number(personalSettings.target_defense_ratio) : 25,
          speed: personalSettings.target_speed_ratio !== undefined ? Number(personalSettings.target_speed_ratio) : 25,
          dexterity: personalSettings.target_dexterity_ratio !== undefined ? Number(personalSettings.target_dexterity_ratio) : 25,
        };

        const current = statsRow ? {
          strength: statsRow.strength,
          defense: statsRow.defense,
          speed: statsRow.speed,
          dexterity: statsRow.dexterity,
          total: statsRow.total_stats,
        } : {
          strength: 0,
          defense: 0,
          speed: 0,
          dexterity: 0,
          total: 0,
        };

        const getProgressBar = (pct: number) => {
          const width = 10;
          const filled = Math.min(width, Math.round((pct / 100) * width));
          const empty = width - filled;
          return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
        };

        const statsFields: string[] = [];
        const statsKeys = ["strength", "speed", "defense", "dexterity"] as const;
        const labels = { strength: "Strength", speed: "Speed", defense: "Defense", dexterity: "Dexterity" };

        for (const key of statsKeys) {
          const value = current[key];
          const targetPct = targets[key];
          const currentPct = current.total > 0 ? (value / current.total) * 100 : 0;
          const deviation = currentPct - targetPct;
          const deviationText = Math.abs(deviation) < 0.05 ? "Balanced" : `${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}%`;
          const bar = getProgressBar(currentPct);
          
          statsFields.push(
            `**${labels[key]}**: ${value.toLocaleString()} (${currentPct.toFixed(1)}% / Target: ${targetPct.toFixed(1)}%) \n${bar} [${deviationText}]`
          );
        }

        const embedTarget = new EmbedBuilder()
          .setColor(0x43b581) // green
          .setTitle("Energy - Stats to Target")
          .setDescription(statsFields.join("\n\n"))
          .addFields(
            { name: "Total Stats", value: current.total.toLocaleString(), inline: true },
            { name: "Target Build", value: build.toUpperCase(), inline: true }
          )
          .setTimestamp();

        await updateOrCreateMessage(
          personalSettings.energy_dashboard_target_channel_id,
          personalSettings.energy_dashboard_target_message_id,
          embedTarget,
          "energy_dashboard_target_message_id"
        );
      } catch (err) {
        logger.error("Failed to sync Stats to Target display:", err);
      }
    }

    // --- 5. Process Display 3: Graph / History ---
    if (personalSettings.energy_dashboard_graph_channel_id) {
      try {
        const snapshots = await db
          .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
          .select(["created_at", "total_stats", "strength", "speed", "defense", "dexterity"])
          .orderBy("created_at", "desc")
          .limit(12) // Fetch slightly more to ensure unique UTC days
          .execute();

        const dailySnapshotsMap = new Map<string, typeof snapshots[0]>();
        for (const snap of snapshots) {
          const dateStr = snap.created_at.split("T")[0]; // YYYY-MM-DD (UTC/TCT)
          if (!dailySnapshotsMap.has(dateStr)) {
            dailySnapshotsMap.set(dateStr, snap);
          }
        }
        
        const uniqueDays = Array.from(dailySnapshotsMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0])); // newest day first

        const historyLines: string[] = [];
        for (let i = 0; i < Math.min(7, uniqueDays.length - 1); i++) {
          const [day, snap] = uniqueDays[i];
          const [, prevSnap] = uniqueDays[i + 1];
          const gain = snap.total_stats - prevSnap.total_stats;
          const strGain = snap.strength - prevSnap.strength;
          const spdGain = snap.speed - prevSnap.speed;
          const defGain = snap.defense - prevSnap.defense;
          const dexGain = snap.dexterity - prevSnap.dexterity;
          
          historyLines.push(
            `**${day}**: ${snap.total_stats.toLocaleString()} (Gain: +${gain.toLocaleString()})\n` +
            `└ Str: +${strGain.toLocaleString()} | Spd: +${spdGain.toLocaleString()} | Def: +${defGain.toLocaleString()} | Dex: +${dexGain.toLocaleString()}`
          );
        }

        const embedHistory = new EmbedBuilder()
          .setColor(0xfaa61a) // orange
          .setTitle("Energy - Stat History")
          .setDescription(historyLines.length > 0 ? historyLines.join("\n\n") : "No history recorded yet.")
          .setTimestamp();

        await updateOrCreateMessage(
          personalSettings.energy_dashboard_graph_channel_id,
          personalSettings.energy_dashboard_graph_message_id,
          embedHistory,
          "energy_dashboard_graph_message_id"
        );
      } catch (err) {
        logger.error("Failed to sync Stat History display:", err);
      }
    }

    // --- 6. Process Display 4: Live TCT Stat Gain Counter ---
    if (personalSettings.energy_dashboard_gains_channel_id) {
      try {
        const days = personalSettings.energy_dashboard_gains_days || 1;
        const now = new Date();
        // Today at 00:00 UTC (TCT)
        const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const daysToSubtract = days - 1;
        const startTimestampSeconds = Math.floor(startOfTodayUtc.getTime() / 1000) - (daysToSubtract * 24 * 60 * 60);

        const gainsLogs = await db
          .selectFrom("sentinel_gym_train_logs" as any)
          .select(["stat", db.fn.sum("gain").as("total_gain"), db.fn.sum("energy").as("total_energy")])
          .where("timestamp", ">=", startTimestampSeconds)
          .groupBy("stat")
          .execute();

        const liveGains = { strength: 0, speed: 0, defense: 0, dexterity: 0, total: 0, energy: 0 };
        for (const row of gainsLogs) {
          const stat = String(row.stat).toLowerCase();
          const gain = parseFloat(String(row.total_gain || 0));
          const energy = parseInt(String(row.total_energy || 0), 10);
          if (stat === "strength") liveGains.strength += gain;
          else if (stat === "speed") liveGains.speed += gain;
          else if (stat === "defense") liveGains.defense += gain;
          else if (stat === "dexterity") liveGains.dexterity += gain;
          liveGains.total += gain;
          liveGains.energy += energy;
        }

        const startDateStr = new Date(startTimestampSeconds * 1000).toUTCString().replace("GMT", "TCT");

        const embedGains = new EmbedBuilder()
          .setColor(0x7289da)
          .setTitle(`Energy - Live Stat Gain Counter`)
          .setDescription(
            `Stat gains logged since **${startDateStr}**:\n\n` +
            `**Strength**: +${liveGains.strength.toLocaleString()}\n` +
            `**Speed**: +${liveGains.speed.toLocaleString()}\n` +
            `**Defense**: +${liveGains.defense.toLocaleString()}\n` +
            `**Dexterity**: +${liveGains.dexterity.toLocaleString()}\n\n` +
            `**Total Gain**: +${liveGains.total.toLocaleString()}\n` +
            `**Energy Spent**: ${liveGains.energy.toLocaleString()} E`
          )
          .setTimestamp();

        await updateOrCreateMessage(
          personalSettings.energy_dashboard_gains_channel_id,
          personalSettings.energy_dashboard_gains_message_id,
          embedGains,
          "energy_dashboard_gains_message_id"
        );
      } catch (err) {
        logger.error("Failed to sync Live TCT Stat Gain Counter display:", err);
      }
    }

  } catch (error) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    logger.error(`Error in energy dashboard performance sync: ${errorMessage}`);
  } finally {
    taskInFlight = false;
  }
}
