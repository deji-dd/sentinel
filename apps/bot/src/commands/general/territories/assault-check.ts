/**
 * Territory Assault Check Command
 * Check if faction can assault a territory based on cooldown constraints
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES, getFactionNameCached } from "@sentinel/shared";
import { decrypt } from "../../../lib/encryption.js";
import { botTornApi } from "../../../lib/torn-api.js";

const STATUS_EMOJI_SUCCESS = "<:Green:1474607376140079104>";
const STATUS_EMOJI_ERROR = "<:Red:1474607810368114886>";

interface ApiKeyEntry {
  key: string; // encrypted
  fingerprint: string;
  isActive: boolean;
  createdAt: string;
}

async function getActiveApiKey(
  supabase: SupabaseClient,
  guildId: string,
): Promise<string | null> {
  const { data: guildConfig } = await supabase
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("api_keys")
    .eq("guild_id", guildId)
    .single();

  const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];
  const activeKey = apiKeys.find((key) => key.isActive);
  if (!activeKey) {
    return null;
  }

  try {
    return decrypt(activeKey.key);
  } catch (error) {
    console.warn("Failed to decrypt API key for assault-check:", error);
    return null;
  }
}

export const data = new SlashCommandBuilder()
  .setName("assault-check")
  .setDescription("Check if your faction can assault a territory")
  .addIntegerOption((opt) =>
    opt
      .setName("faction_id")
      .setDescription("Faction ID to check")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("territory_id")
      .setDescription("Territory ID or code (e.g., LSG)")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

    const factionId = interaction.options.getInteger("faction_id", true);
    const territoryId = interaction.options.getString("territory_id", true);
    const guildId = interaction.guildId;
    const apiKey = guildId ? await getActiveApiKey(supabase, guildId) : null;
    const factionName = await getFactionNameCached(
      supabase,
      factionId,
      botTornApi,
      apiKey,
    );
    const factionDisplay = factionName
      ? `${factionName} (${factionId})`
      : `Faction ${factionId} (${factionId})`;
    const needsApiKeyWarning = !apiKey && !factionName;

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: wars, error: warsError } = await supabase
      .from(TABLE_NAMES.WAR_LEDGER)
      .select("*")
      .gte("start_time", ninetyDaysAgo.toISOString())
      .order("start_time", { ascending: false });

    if (warsError) {
      throw warsError;
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⚔️ Territory Assault Check")
      .addFields({
        name: "Faction",
        value: factionDisplay,
        inline: true,
      })
      .addFields({
        name: "Territory",
        value: territoryId.toUpperCase(),
        inline: true,
      });

    if (needsApiKeyWarning) {
      embed.addFields({
        name: "API Key",
        value:
          "No API key configured for live faction lookup. Displayed name may be unavailable.",
        inline: false,
      });
    }

    // Check last territory loss: 72 hour cooldown
    const factionWarsDef = wars?.filter(
      (w) =>
        (w.defending_faction === factionId ||
          w.assaulting_faction === factionId) &&
        w.victor_faction !== factionId,
    );

    let canAssault = true;
    const issues: string[] = [];

    if (factionWarsDef && factionWarsDef.length > 0) {
      const lastLoss = factionWarsDef[0]; // Most recent loss first
      const lossTrigger = 72 * 60 * 60 * 1000; // 72 hours

      // Check if this was their last territory (harder to determine without ownership data)
      const timeSinceLoss =
        Date.now() - new Date(lastLoss.start_time).getTime();

      if (timeSinceLoss < lossTrigger) {
        const hoursRemaining = Math.ceil(
          (lossTrigger - timeSinceLoss) / (60 * 60 * 1000),
        );
        issues.push(
          `⏱️ Recent territory loss cooldown: ${hoursRemaining}h remaining (if was last territory)`,
        );
      }
    }

    // Check specific territory cooldowns
    const territoryWars = wars?.filter(
      (w) => w.territory_id === territoryId.toUpperCase(),
    );

    if (territoryWars && territoryWars.length > 0) {
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
          issues.push(
            `⏱️ Lost war on this territory: ${hoursRemaining}h remaining`,
          );
          canAssault = false;
        }
      }

      // Check 90-day rule: if any war on this territory, must wait 72h after ANY war
      if (territoryWars.length > 0) {
        const lastWarOnThis = territoryWars[0];
        const timeSinceAnyWar =
          Date.now() - new Date(lastWarOnThis.start_time).getTime();
        const waitTrigger = 72 * 60 * 60 * 1000;

        if (timeSinceAnyWar < waitTrigger) {
          const hoursRemaining = Math.ceil(
            (waitTrigger - timeSinceAnyWar) / (60 * 60 * 1000),
          );
          issues.push(
            `⏱️ War cooldown (any faction): ${hoursRemaining}h remaining`,
          );
          canAssault = false;
        }
      }
    }

    // Determine overall status
    if (canAssault && issues.length === 0) {
      embed.setColor(0x22c55e);
      embed.addFields({
        name: "Status",
        value: `${STATUS_EMOJI_SUCCESS} **Can Assault**`,
        inline: false,
      });
      embed.addFields({
        name: "Details",
        value:
          "No active cooldowns - faction is eligible to assault this territory",
        inline: false,
      });
    } else if (!canAssault) {
      embed.setColor(0xef4444);
      embed.addFields({
        name: "Status",
        value: `${STATUS_EMOJI_ERROR} **Cannot Assault**`,
        inline: false,
      });
      embed.addFields({
        name: "Active Cooldowns",
        value: issues.join("\n"),
        inline: false,
      });
    } else {
      // Warnings but can still assault
      embed.setColor(0xf59e0b);
      embed.addFields({
        name: "Status",
        value: "⚠️ **Can Assault (With Warnings)**",
        inline: false,
      });
      embed.addFields({
        name: "Active Cooldowns",
        value: issues.join("\n"),
        inline: false,
      });
    }

    // Data freshness warning
    let showDataWarning = false;
    let dataWarningText =
      "No war history found in the last 90 days. Results may be inaccurate.";

    if (!wars || wars.length === 0) {
      showDataWarning = true;
    } else {
      const oldestWar = wars[wars.length - 1];
      const oldestStart = new Date(oldestWar.start_time);
      if (oldestStart > ninetyDaysAgo) {
        const daysCoverage = Math.max(
          1,
          Math.floor((Date.now() - oldestStart.getTime()) / 86400000),
        );
        showDataWarning = true;
        dataWarningText = `Only ~${daysCoverage} day${daysCoverage === 1 ? "" : "s"} of war data available. Results may be inaccurate.`;
      }
    }

    if (showDataWarning) {
      embed.addFields({
        name: "⚠️ Data Warning",
        value: dataWarningText,
        inline: false,
      });
      embed.setFooter({
        text: "Results may be incomplete without 90 days of war data.",
      });
    }

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    let errorMsg = "An unknown error occurred";

    if (error instanceof Error) {
      errorMsg = error.message;
    } else if (typeof error === "object" && error !== null) {
      errorMsg =
        (error as Record<string, unknown>).message?.toString() ||
        JSON.stringify(error);
    } else if (typeof error === "string") {
      errorMsg = error;
    }

    console.error("Error in assault-check command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`${STATUS_EMOJI_ERROR} Error`)
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
