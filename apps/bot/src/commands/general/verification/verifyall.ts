import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import {
  VerificationJobs,
  GuildConfigs,
  type VerificationJobDocument,
  type GuildConfigDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

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
    const config = GuildConfigs.find(
      (c: GuildConfigDocument) => c.guild_id === guildId,
    )[0];
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

    // 3. Map them into our NoSQL Job Schema
    const now = Date.now();
    const jobs: VerificationJobDocument[] = humanMembers.map((member) => ({
      id: randomUUID(), // Required by BaseDocument
      guild_id: guildId,
      discord_id: member.id,
      status: "pending",
      module: "manual_sync",
      payload: {},
      created_at: now,
    }));

    // 4. Bulk insert into SQLite (Takes < 10ms for 1,000 rows)
    if (jobs.length > 0) {
      VerificationJobs.insertMany(jobs);
    }

    await interaction.editReply(
      `Successfully queued background verification for **${jobs.length}** members. Changes will appear shortly!`,
    );
  } catch (error) {
    console.error("[VerifyAll] Error queuing jobs:", error);
    await interaction.editReply(
      "An internal error occurred while queuing the sync.",
    );
  }
}
