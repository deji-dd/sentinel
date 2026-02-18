import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify a Discord user's Torn City account connection")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to verify (defaults to you)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser("user") || interaction.user;

    // TODO: Determine which API key to use
    // - Could be bot's service account key
    // - Or user's authenticated key from database
    const apiKey = process.env.TORN_API_KEY;

    if (!apiKey) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Configuration Error")
        .setDescription("Bot API key is not configured.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Call Torn API to check user's Discord linkage and faction
    const response = await fetch(
      `https://api.torn.com/v2/user/${targetUser.id}/discord/faction`,
      {
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          Accept: "application/json",
        },
      },
    );

    const data = await response.json();

    // Handle API errors
    if (data.error) {
      const errorCode = data.error.code;

      if (errorCode === 6) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Not Linked")
          .setDescription(
            `${targetUser.username} has not linked their Discord account to Torn City yet.`,
          );

        await interaction.editReply({
          embeds: [errorEmbed],
        });
        return;
      }

      // Handle other API errors
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription(data.error.error || "Failed to verify user.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Success - user is linked
    // TODO: Extract and display faction information from response
    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Verified")
      .setDescription(
        `${targetUser.username} has linked their Discord account to Torn City.`,
      )
      .setFooter({
        text: "Use /setup-guild to enable faction role assignments",
      });

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in verify command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
