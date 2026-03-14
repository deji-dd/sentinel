import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  Client,
  MessageFlags,
} from "discord.js";
import { performBackup } from "../../../tasks/db-backup-task.js";

export const data = new SlashCommandBuilder()
  .setName("db-backup")
  .setDescription("Manually trigger a full database backup and send it via DM.");

export async function execute(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await performBackup(client);

    const successEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Backup Complete")
      .setDescription(
        "The database backup has been generated and sent to your DMs."
      );

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in db-backup command:", errorMsg);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Backup Failed")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
