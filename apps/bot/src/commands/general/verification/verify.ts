import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  VerificationJobs,
  GuildConfigs,
  type VerificationJobDocument,
  type GuildConfigDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

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
    const config = GuildConfigs.find(
      (c: GuildConfigDocument) => c.guild_id === guildId,
    )[0];
    if (!config) {
      await interaction.editReply(
        "This server has not been configured for verification yet.",
      );
      return;
    }

    // 2. Queue the job in the database
    const job: VerificationJobDocument = {
      id: randomUUID(),
      guild_id: guildId,
      discord_id: targetUser.id,
      status: "pending",
      module: "manual_sync",
      payload: {},
      created_at: Date.now(), // Unix epoch for the system maintenance pruner
    };

    VerificationJobs.insertOne(job);

    // 3. Respond instantly
    const successEmbed = new EmbedBuilder()
      .setColor(0x3b82f6) // Blue for pending
      .setTitle("Verification Queued")
      .setDescription(
        `The verification request for ${targetUser} has been placed in the queue.\n\nRoles and nicknames will automatically update in a few seconds.`,
      );

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    console.error("[Verify Command] Error queuing job:", error);
    await interaction.editReply(
      "An internal error occurred while queuing the verification.",
    );
  }
}
