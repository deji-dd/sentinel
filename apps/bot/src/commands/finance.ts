import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getPersonalUserId } from "../lib/auth.js";
import {
  runWithInteractionError,
  safeReply,
} from "../lib/interaction-utils.js";

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.floor(value)).toLocaleString("en-US")}`;
}

function formatSnapshotTime(value?: string | null): string {
  if (!value) {
    return "Unknown";
  }

  return (
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " TCT"
  );
}

export const data = new SlashCommandBuilder()
  .setName("finance")
  .setDescription("Show your latest finance snapshot and budget split")
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await runWithInteractionError(
    interaction,
    async () => {
      await interaction.deferReply();

      const userId = getPersonalUserId();

      const [snapshotResult, settingsResult] = await Promise.all([
        supabase
          .from(TABLE_NAMES.USER_SNAPSHOTS)
          .select(
            "created_at, liquid_cash, bookie_value, bookie_updated_at, net_worth",
          )
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from(TABLE_NAMES.FINANCE_SETTINGS)
          .select("min_reserve, split_bookie, split_training, split_gear")
          .eq("player_id", userId)
          .maybeSingle(),
      ]);

      if (snapshotResult.error) {
        await safeReply(
          interaction,
          "❌ Failed to load finance snapshot. Please try again.",
        );
        return;
      }

      const snapshot = snapshotResult.data?.[0];
      if (!snapshot) {
        const emptyEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("💰 Finance Snapshot Unavailable")
          .setDescription(
            "No finance snapshots are available yet. The worker needs to capture at least one snapshot before budgets can be calculated.",
          )
          .setFooter({ text: "Sentinel Finance" })
          .setTimestamp();

        await safeReply(interaction, { embeds: [emptyEmbed] });
        return;
      }

      if (settingsResult.error) {
        await safeReply(
          interaction,
          "❌ Failed to load finance settings. Please try again.",
        );
        return;
      }

      if (!settingsResult.data) {
        const setupEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("💰 Finance Settings Needed")
          .setDescription(
            "Set your finance settings before we can calculate budgets.",
          )
          .addFields(
            {
              name: "Next Step",
              value:
                "Run `/finance-settings` to set your reserve and split %s.",
              inline: false,
            },
            {
              name: "Latest Snapshot",
              value: `Liquid Cash: ${formatMoney(Number(snapshot.liquid_cash ?? 0))}\nSnapshot: ${formatSnapshotTime(snapshot.created_at)}`,
              inline: false,
            },
          )
          .setFooter({ text: "Sentinel Finance" })
          .setTimestamp();

        await safeReply(interaction, { embeds: [setupEmbed] });
        return;
      }

      const rawSettings = settingsResult.data;
      const splitTotal =
        rawSettings.split_bookie +
        rawSettings.split_training +
        rawSettings.split_gear;
      const normalizedTotal = splitTotal > 0 ? splitTotal : 100;

      const liquidCash = Number(snapshot.liquid_cash ?? 0);
      const bookieValue = Number(snapshot.bookie_value ?? 0);
      const minReserve = Number(rawSettings.min_reserve ?? 0);
      const spendableLiquid = Math.max(0, liquidCash - minReserve);

      // Total liquid available includes wallet + company + bookie
      const totalLiquidAvailable = spendableLiquid;

      // Target budget allocations
      const targetBookiePercent = rawSettings.split_bookie / normalizedTotal;
      const targetTrainingPercent =
        rawSettings.split_training / normalizedTotal;

      // When calculating bookie budget: we need to reach target% of total liquid
      // If we already have X in bookie, we only need to add (target% × total - X)
      // But for display purposes, we show how much MORE to add to reach target
      const targetBookieAmount = Math.floor(
        totalLiquidAvailable * targetBookiePercent,
      );
      const bookieBudgetNeeded = Math.max(0, targetBookieAmount - bookieValue);

      // Training and gear budgets come from what's left after allocating to bookie target
      const afterBookieAllocation = Math.max(
        0,
        totalLiquidAvailable - targetBookieAmount,
      );
      const trainingBudget = Math.floor(
        afterBookieAllocation * targetTrainingPercent,
      );
      const gearBudget = Math.max(0, afterBookieAllocation - trainingBudget);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("💼 Finance Snapshot")
        .setDescription(
          "Here is your latest financial snapshot and how your spendable liquid is split across budgets.",
        )
        .addFields(
          {
            name: "Liquid Cash",
            value: formatMoney(liquidCash),
            inline: true,
          },
          {
            name: "Minimum Reserve",
            value: formatMoney(minReserve),
            inline: true,
          },
          {
            name: "Spendable Liquid",
            value: formatMoney(spendableLiquid),
            inline: true,
          },
          {
            name: "Training Budget",
            value: `${formatMoney(trainingBudget)} (${rawSettings.split_training}%)`,
            inline: true,
          },
          {
            name: "Bookie Budget Needed",
            value: `${formatMoney(bookieBudgetNeeded)} (${rawSettings.split_bookie}%)`,
            inline: true,
          },
          {
            name: "Gear Budget",
            value: `${formatMoney(gearBudget)} (${rawSettings.split_gear}%)`,
            inline: true,
          },
          {
            name: "Bookie Value",
            value: formatMoney(Number(snapshot.bookie_value ?? 0)),
            inline: true,
          },
          {
            name: "Net Worth",
            value: formatMoney(Number(snapshot.net_worth ?? 0)),
            inline: true,
          },
          {
            name: "Snapshot Time",
            value: formatSnapshotTime(snapshot.created_at),
            inline: true,
          },
          {
            name: "Bookie Updated",
            value: formatSnapshotTime(snapshot.bookie_updated_at),
            inline: true,
          },
        )
        .setFooter({ text: "Sentinel Finance" })
        .setTimestamp();

      await safeReply(interaction, { embeds: [embed] });
    },
    "Unexpected finance error",
  );
}
