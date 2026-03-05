import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  calculateStatsSummaryForTimeframe,
  buildStatsSummaryEmbedForTimeframe,
} from "../../utils/daily-summary-embed.js";
import {
  runWithInteractionError,
  safeReply,
} from "../../lib/interaction-utils.js";

const TIMEFRAME_OPTIONS = {
  TODAY: {
    label: "Today",
    value: "today",
    getStartDate: () => {
      const now = new Date();
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return start;
    },
    displayLabel: "Today",
  },
  SEVEN_DAYS: {
    label: "Last 7 Days",
    value: "7d",
    getStartDate: () => {
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 7);
      return start;
    },
    displayLabel: "Last 7 Days",
  },
  THIRTY_DAYS: {
    label: "Last 30 Days",
    value: "30d",
    getStartDate: () => {
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 30);
      return start;
    },
    displayLabel: "Last 30 Days",
  },
  ALL: {
    label: "All Time",
    value: "all",
    getStartDate: () => {
      // Go back to year 2000 as a practical "all time" start
      return new Date("2000-01-01T00:00:00Z");
    },
    displayLabel: "All Time",
  },
} as const;

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription(
    "View your battlestats progress for a custom timeframe (Today, 7d, 30d, All)",
  )
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await runWithInteractionError(
    interaction,
    async () => {
      await interaction.deferReply();

      // Build the select menu
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("stats_timeframe_select")
        .setPlaceholder("Select a timeframe")
        .addOptions(
          ...Object.values(TIMEFRAME_OPTIONS).map((option) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(option.label)
              .setValue(option.value)
              .setDescription(`View stats for ${option.displayLabel}`),
          ),
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        selectMenu,
      );

      await safeReply(interaction, {
        content: "Choose a timeframe to view your stats:",
        components: [row],
      });
    },
    "Failed to load stats timeframe selector",
  );
}

/**
 * Handle the select menu interaction for timeframe selection
 */
export async function handleTimeframeSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await runWithInteractionError(
    interaction,
    async () => {
      await interaction.deferUpdate();

      const timeframeValue = interaction.values[0];
      const timeframeConfig = Object.values(TIMEFRAME_OPTIONS).find(
        (opt) => opt.value === timeframeValue,
      );

      if (!timeframeConfig) {
        await safeReply(interaction, {
          content: "Invalid timeframe selected",
          ephemeral: true,
        });
        return;
      }

      const startDate = timeframeConfig.getStartDate();
      const summary = await calculateStatsSummaryForTimeframe(startDate);

      const title = `📊 Stats Summary - ${timeframeConfig.displayLabel}`;
      const embed = buildStatsSummaryEmbedForTimeframe(summary, title);

      await safeReply(interaction, {
        content: `**${timeframeConfig.displayLabel}**`,
        embeds: [embed],
      });
    },
    "Failed to load stats for this timeframe",
  );
}
