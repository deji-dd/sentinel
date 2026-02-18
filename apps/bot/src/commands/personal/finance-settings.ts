import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getPersonalUserId } from "../../lib/auth.js";
import {
  runWithInteractionError,
  safeReply,
} from "../../lib/interaction-utils.js";

function parseNumber(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.floor(value)).toLocaleString("en-US")}`;
}

export const data = {
  name: "finance-settings",
  description: "Update your finance budget splits",
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await runWithInteractionError(
    interaction,
    async () => {
      const modal = new ModalBuilder()
        .setCustomId("finance_settings_modal")
        .setTitle("Finance Settings");

      const minReserveInput = new TextInputBuilder()
        .setCustomId("min_reserve")
        .setLabel("Minimum Reserve (cash to keep)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 250000000")
        .setRequired(true);

      const splitBookieInput = new TextInputBuilder()
        .setCustomId("split_bookie")
        .setLabel("Bookie Split %")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 60")
        .setRequired(true);

      const splitTrainingInput = new TextInputBuilder()
        .setCustomId("split_training")
        .setLabel("Training Split %")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 30")
        .setRequired(true);

      const splitGearInput = new TextInputBuilder()
        .setCustomId("split_gear")
        .setLabel("Gear Split %")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 10")
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(minReserveInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          splitBookieInput,
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          splitTrainingInput,
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(splitGearInput),
      );

      await interaction.showModal(modal);
    },
    "Unexpected finance settings error",
  );
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await runWithInteractionError(
    interaction,
    async () => {
      await interaction.deferReply();

      const minReserveValue = parseNumber(
        interaction.fields.getTextInputValue("min_reserve").trim(),
      );
      const splitBookieValue = parseNumber(
        interaction.fields.getTextInputValue("split_bookie").trim(),
      );
      const splitTrainingValue = parseNumber(
        interaction.fields.getTextInputValue("split_training").trim(),
      );
      const splitGearValue = parseNumber(
        interaction.fields.getTextInputValue("split_gear").trim(),
      );

      if (
        minReserveValue === null ||
        splitBookieValue === null ||
        splitTrainingValue === null ||
        splitGearValue === null
      ) {
        await safeReply(
          interaction,
          "❌ Invalid input. Use whole numbers only (commas allowed).",
        );
        return;
      }

      if (minReserveValue < 0) {
        await safeReply(
          interaction,
          "❌ Minimum reserve must be zero or higher.",
        );
        return;
      }

      if (
        splitBookieValue < 0 ||
        splitTrainingValue < 0 ||
        splitGearValue < 0
      ) {
        await safeReply(
          interaction,
          "❌ Split percentages must be zero or higher.",
        );
        return;
      }

      const splitTotal = splitBookieValue + splitTrainingValue + splitGearValue;
      if (splitTotal !== 100) {
        await safeReply(
          interaction,
          "❌ Split percentages must add up to 100%.",
        );
        return;
      }

      const userId = getPersonalUserId();

      const { error } = await supabase
        .from(TABLE_NAMES.FINANCE_SETTINGS)
        .upsert(
          {
            player_id: userId,
            min_reserve: minReserveValue,
            split_bookie: splitBookieValue,
            split_training: splitTrainingValue,
            split_gear: splitGearValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "player_id" },
        );

      if (error) {
        await safeReply(
          interaction,
          "❌ Failed to update finance settings. Please try again.",
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle("✅ Finance Settings Updated")
        .setDescription(
          "Your finance settings are saved. Use `/finance` to view the updated budgets.",
        )
        .addFields(
          {
            name: "Minimum Reserve",
            value: formatMoney(minReserveValue),
            inline: true,
          },
          {
            name: "Bookie Split",
            value: `${splitBookieValue}%`,
            inline: true,
          },
          {
            name: "Training Split",
            value: `${splitTrainingValue}%`,
            inline: true,
          },
          {
            name: "Gear Split",
            value: `${splitGearValue}%`,
            inline: true,
          },
        )
        .setFooter({ text: "Sentinel Finance" })
        .setTimestamp();

      await safeReply(interaction, { embeds: [embed] });
    },
    "Unexpected finance settings error",
  );
}
