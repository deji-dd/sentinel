import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { GuildConfigs, VerificationRequest } from "@sentinel/shared";
import { dispatchToWorker } from "../../../lib/ipc/index.js";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify a Discord user's account against Torn.")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("User to verify (defaults to you)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const targetUser = interaction.options.getUser("user") || interaction.user;

  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // 1. Fast synchronous check to ensure the guild is configured
    const config = GuildConfigs.find({ guild_id: guildId })[0];
    if (!config) {
      await interaction.editReply(
        "This server has not been configured for verification yet.",
      );
      return;
    }

    // 2. Fetch the actual GuildMember to get their current roles and nickname
    const targetMember = await interaction.guild?.members
      .fetch(targetUser.id)
      .catch(() => null);

    const job: VerificationRequest = {
      guild_id: guildId,
      channel_id: interaction.channelId,
      discord_id: targetUser.id,
      current_role_ids: targetMember
        ? Array.from(targetMember.roles.cache.keys())
        : [],
      current_nickname: targetMember?.nickname || null,
    };
    dispatchToWorker({ action: "verify", data: job });

    // 3. Respond instantly
    const successEmbed = new EmbedBuilder()
      .setColor(0x3b82f6) // Blue for pending
      .setTitle("Verification Queued")
      .setDescription(
        `The verification request for ${targetUser} has been placed in the queue.`,
      );

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    console.error("[Verify Command] Error queuing job:", error);
    await interaction.editReply(
      "An internal error occurred while queuing the verification.",
    );
  }
}
