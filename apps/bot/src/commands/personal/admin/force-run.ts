import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { TABLE_NAMES } from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";

export const data = new SlashCommandBuilder()
  .setName("force-run")
  .setDescription("Force-run a worker immediately (trigger execution)")
  .addStringOption((option) =>
    option
      .setName("worker")
      .setDescription("Which worker to run")
      .setRequired(true)
      .addChoices(
        { name: "Travel Data Sync", value: "travel_data_worker" },
        {
          name: "Travel Recommendations",
          value: "travel_recommendations_worker",
        },
        { name: "Travel Stock Cache", value: "travel_stock_cache_worker" },
        {
          name: "Training Recommendations",
          value: "training_recommendations_worker",
        },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const workerName = interaction.options.getString("worker", true);

    // Look up worker ID by name
    const db = getDB();
    const worker = db
      .prepare(`SELECT id FROM "${TABLE_NAMES.WORKERS}" WHERE name = ? LIMIT 1`)
      .get(workerName) as { id: number } | undefined;

    if (!worker) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Worker Not Found")
        .setDescription(`Worker **${workerName}** does not exist`);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Trigger the worker by setting force_run flag
    const updateResult = db
      .prepare(
        `UPDATE "${TABLE_NAMES.WORKER_SCHEDULES}" SET force_run = 1 WHERE worker_id = ?`,
      )
      .run(worker.id);

    if (updateResult.changes === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Trigger Worker")
        .setDescription(
          "No worker schedule found for this worker. Ensure it is registered first.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("🚀 Worker Triggered")
      .setDescription(`**${workerName}** has been queued for execution`)
      .addFields(
        {
          name: "📊 Worker",
          value: workerName,
          inline: true,
        },
        {
          name: "⏱️ Status",
          value: "pending",
          inline: true,
        },
      )
      .setFooter({
        text: "Worker will execute on next scheduler poll (within 5s)",
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in force-run command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
