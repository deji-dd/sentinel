import { Events, GuildMember } from "discord.js";
import {
  VerificationJobs,
  GuildConfigs,
  type VerificationJobDocument,
  type GuildConfigDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

export const name = Events.GuildMemberAdd;
export const once = false;

export async function execute(member: GuildMember) {
  if (member.user.bot) return;

  const guildId = member.guild.id;

  // 1. Check if the server actually wants Auto-Verify enabled
  const config = GuildConfigs.find(
    (c: GuildConfigDocument) => c.guild_id === guildId,
  )[0];
  if (!config || !config.auto_verify) return;

  // 2. Queue the job
  const job: VerificationJobDocument = {
    id: randomUUID(),
    guild_id: guildId,
    discord_id: member.id,
    status: "pending",
    module: "auto_verify",
    payload: {},
    created_at: Date.now(),
  };

  VerificationJobs.insertOne(job);

  // The Worker picks it up in ~2 seconds, does the API math,
  // and fires the IPC message back to the Bot to assign the roles.
}
