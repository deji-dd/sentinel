import { Events, GuildMember } from "discord.js";
import { GuildConfigs, VerificationRequest } from "@sentinel/shared";
import { dispatchToWorker } from "../lib/ipc/index.js";

export const name = Events.GuildMemberAdd;
export const once = false;

export async function execute(member: GuildMember) {
  if (member.user.bot) return;

  const guildId = member.guild.id;

  // 1. Check if the server wants verification on join enabled
  const config = GuildConfigs.find({ guild_id: guildId })[0];
  if (!config || !config.verify_on_join) return;

  const job: VerificationRequest = {
    guild_id: guildId,
    channel_id: config.log_channel_id,
    discord_id: member.id,
    current_role_ids: member ? Array.from(member.roles.cache.keys()) : [],
    current_nickname: member?.nickname || null,
  };
  dispatchToWorker({ action: "verify", data: job });

  // The Worker picks it up in ~2 seconds, does the API math,
  // and fires the IPC message back to the Bot to assign the roles.
}
