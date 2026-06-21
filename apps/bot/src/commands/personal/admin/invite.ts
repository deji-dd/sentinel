import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("invite")
  .setDescription("Generate an invite link to add this bot to other guilds");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    const isDev = process.env.NODE_ENV === "development";
    const clientId = isDev
      ? process.env.DISCORD_CLIENT_ID_LOCAL
      : process.env.DISCORD_CLIENT_ID;

    if (!clientId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Configuration Error")
        .setDescription("Discord client ID not configured")
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      await interaction.reply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Permissions: Administrator (includes all permissions)
    const permissions = [
      "Administrator",
    ];
    const permissionBits = BigInt(8); // ADMINISTRATOR = 1 << 3 = 8

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissionBits}&scope=bot+applications.commands`;

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Invite Bot to Guild")
      .setDescription(
        "Click the link below to add this bot to another Discord guild:",
      )
      .addFields(
        {
          name: "Invite Link",
          value: `[Add Sentinel Bot](${inviteUrl})`,
        },
        {
          name: "Permissions",
          value: permissions.join(", "),
        },
      )
      .setFooter({
        text: "Sentinel",
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in invite command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription(errorMsg)
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    await interaction.reply({
      embeds: [errorEmbed],
    });
  }
}
