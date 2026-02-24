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
import { TABLE_NAMES } from "@sentinel/shared";

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
    await interaction.deferReply({ ephemeral: true });

    const factionId = interaction.options.getInteger("faction_id", true);
    const territoryId = interaction.options.getString("territory_id", true);

    // Fetch war ledger from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: wars, error: warsError } = await supabase
      .from(TABLE_NAMES.WAR_LEDGER)
      .select("*")
      .gte("started", ninetyDaysAgo.toISOString())
      .order("started", { ascending: false });

    if (warsError) {
      throw warsError;
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("⚔️ Territory Assault Check")
      .addFields({
        name: "Faction",
        value: String(factionId),
        inline: true,
      })
      .addFields({
        name: "Territory",
        value: territoryId.toUpperCase(),
        inline: true,
      });

    // Check last territory loss: 72 hour cooldown
    const factionWarsDef = wars?.filter(
      (w) =>
        (w.defending_faction_id === factionId ||
          w.assaulting_faction_id === factionId) &&
        w.winner_faction_id !== factionId,
    );

    let canAssault = true;
    const issues: string[] = [];

    if (factionWarsDef && factionWarsDef.length > 0) {
      const lastLoss = factionWarsDef[0]; // Most recent loss first
      const lossTrigger = 72 * 60 * 60 * 1000; // 72 hours

      // Check if this was their last territory (harder to determine without ownership data)
      const timeSinceLoss = Date.now() - new Date(lastLoss.started).getTime();

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
          (w.assaulting_faction_id === factionId ||
            w.defending_faction_id === factionId) &&
          w.winner_faction_id !== factionId,
      );

      if (factionsWarOnThis.length > 0) {
        const lastLossOnThis = factionsWarOnThis[0];
        const timeSinceLoss =
          Date.now() - new Date(lastLossOnThis.started).getTime();
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
          Date.now() - new Date(lastWarOnThis.started).getTime();
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
        value: "✅ **Can Assault**",
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
        value: "❌ **Cannot Assault**",
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
    if (!wars || wars.length === 0) {
      embed.addFields({
        name: "⚠️ Data Warning",
        value:
          "No war history found in last 90 days. Check back after first assault.",
        inline: false,
      });
    }

    embed.setFooter({
      text: "Constraints subject to Torn City rules. Verify before assaulting.",
    });

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in assault-check command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
