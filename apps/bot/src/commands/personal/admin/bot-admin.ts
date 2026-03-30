import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { MagicLinkService } from "../../../services/magic-link-service.js";
import { getApiUrl } from "../../../lib/bot-config.js";

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

export const data = new SlashCommandBuilder()
  .setName("bot-admin")
  .setDescription("Access global bot administration dashboard (Owner only)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.user.id !== botOwnerId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Not Authorized")
        .setDescription("Only the bot owner can use this command.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Error")
        .setDescription("This command can only be used in the administration guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Generate Admin Magic Link
    const magicLinkService = new MagicLinkService(interaction.client);
    const token = await magicLinkService.createToken({
      discordId: interaction.user.id,
      guildId: guildId,
      scope: "admin",
      targetPath: "/admin",
    });

    const apiUrl = getApiUrl();
    const magicLinkUrl = `${apiUrl}/api/auth/magic-link?token=${token}`;

    const adminEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🛡️ Sentinel Administration")
      .setDescription(
        "Secure access to the global bot dashboard. From here, you can manage backups, deploy command updates, and manage all server configurations.",
      )
      .addFields({
        name: "Restricted Access",
        value:
          "This link is single-use and restricted to the bot owner. It will automatically expire after activation or 15 minutes of inactivity.",
      })
      .setTimestamp()
      .setFooter({
        text: "Global Administrator Mode // Secure Session Active",
      });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Launch Admin Dashboard")
        .setURL(magicLinkUrl)
        .setStyle(ButtonStyle.Link),
    );

    await interaction.editReply({
      embeds: [adminEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in bot-admin command:", errorMsg);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
