import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { GuildConfigs } from "@sentinel/shared";
import { dispatchToWorker } from "../../../lib/ipc/index.js";

export const data = new SlashCommandBuilder()
  .setName("verifyall")
  .setDescription(
    "Queues a background sync of Torn roles and nicknames for all members.",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId)
    return interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });

  await interaction.deferReply({ ephemeral: true });

  try {
    // 1. Verify the guild is actually configured for Sentinel
    const config = GuildConfigs.find({ guild_id: guildId })[0];
    if (!config) {
      return interaction.editReply(
        "This server has not been configured for verification yet.",
      );
    }

    // 2. Fetch all members currently in the Discord server
    const guild = await interaction.client.guilds.fetch(guildId);
    const members = await guild.members.fetch();

    // Filter out bots, they don't play Torn
    const humanMembers = members.filter((m) => !m.user.bot);

    // 3. Map them into VerificationRequest IPC payloads
    const jobs = humanMembers.map((member) => ({
      guild_id: guildId,
      channel_id: interaction.channelId,
      discord_id: member.id,
      current_role_ids: Array.from(member.roles.cache.keys()),
      current_nickname: member.nickname || null,
    }));

    // 4. Send them as a bulk packet to the worker
    dispatchToWorker({ action: "verify_bulk", data: jobs });

    const successEmbed = new EmbedBuilder()
      .setColor(0x3b82f6) // Blue for pending
      .setTitle("Verification Queued")
      .setDescription(
        `The verification request for  **${jobs.length}** members has been placed in the queue.`,
      );

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    console.error("[VerifyAll] Error queuing jobs:", error);
    await interaction.editReply(
      "An internal error occurred while queuing the sync.",
    );
  }
}
