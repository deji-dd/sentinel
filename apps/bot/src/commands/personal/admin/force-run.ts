import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";

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
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply();

    const workerName = interaction.options.getString("worker", true);

    // Look up worker ID by name
    const { data: worker, error: lookupError } = await supabase
      .from(TABLE_NAMES.WORKERS)
      .select("id")
      .eq("name", workerName)
      .single();

    if (lookupError || !worker) {
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
    const { error: triggerError } = await supabase
      .from(TABLE_NAMES.WORKER_SCHEDULES)
      .update({ force_run: true })
      .eq("worker_id", worker.id);

    if (triggerError) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Trigger Worker")
        .setDescription(triggerError.message);

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
