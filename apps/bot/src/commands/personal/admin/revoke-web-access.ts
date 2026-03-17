import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { MagicLinkService } from "../../../lib/services/magic-link-service.js";

export const data = new SlashCommandBuilder()
  .setName("revoke-web-access")
  .setDescription("Revoke a user's ability to generate web magic links and clear active sessions")
  .addUserOption(option => 
    option.setName("user")
      .setDescription("The user to revoke")
      .setRequired(true))
  .addStringOption(option =>
    option.setName("reason")
      .setDescription("Reason for revocation")
      .setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") || "No reason provided";
  
  const magicLinkService = new MagicLinkService(interaction.client);

  try {
    await magicLinkService.revokeUser(targetUser.id, interaction.user.id, reason);

    const embed = new EmbedBuilder()
      .setTitle("⛔ Access Revoked")
      .setDescription(`Successfully revoked web access for <@${targetUser.id}>. All active sessions have been terminated.`)
      .addFields({ name: "Reason", value: reason })
      .setColor(0xEF4444)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error revoking user:", error);
    await interaction.reply({ 
      content: "Failed to revoke user access.", 
      ephemeral: true 
    });
  }
}
