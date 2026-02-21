import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const data = new SlashCommandBuilder()
  .setName("test-verification-dms")
  .setDescription("Send sample verification DM messages to your DMs");

export async function execute(
  interaction: ChatInputCommandInteraction,
  _supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.user;

    // SUCCESS MESSAGE
    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Automatically Verified")
      .setDescription(
        `Welcome to **Example Discord Server**! You've been automatically verified.`,
      )
      .addFields(
        { name: "Torn Name", value: "John Doe", inline: true },
        { name: "Torn ID", value: "123456", inline: true },
        { name: "Faction", value: "Epic Mafia [EM]", inline: true },
      );

    // NOT LINKED MESSAGE
    const notLinkedEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Not Linked to Torn")
      .setDescription(
        `Your Discord account is not linked to a Torn account. Visit **https://www.torn.com/preferences.php** to link your account.`,
      );

    // ERROR MESSAGE
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Verification Failed")
      .setDescription(
        `An error occurred while verifying your account: **API rate limit exceeded**. Please try the /verify command manually.`,
      );

    // Send all three messages
    await user.send({
      content: "**TEST: Success Case** ✅",
      embeds: [successEmbed],
    });

    await user.send({
      content: "**TEST: Not Linked Case** ❌",
      embeds: [notLinkedEmbed],
    });

    await user.send({
      content: "**TEST: Error Case** ❌",
      embeds: [errorEmbed],
    });

    await interaction.editReply({
      content: "✅ Sent 3 sample verification messages to your DMs!",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error";

    console.error("Test verification DMs error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(message);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}
