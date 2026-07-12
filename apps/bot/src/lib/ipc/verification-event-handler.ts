import { Logger, toBotPacket } from "@sentinel/shared";
import { Client, EmbedBuilder, Guild, TextChannel } from "discord.js";
import { logGuildError } from "../guild-logger.js";

export async function handleVerificationEvent(
  client: Client,
  packet: toBotPacket,
  logger: Logger,
  finishSync: () => void,
) {
  const { action, data } = packet;
  let guild: Guild | null = null;

  if (action === "verification_success" || action === "verification_fail") {
    guild = await client.guilds.fetch(data.guild_id).catch(() => null);
    if (!guild) {
      logger.debug(
        `Failed to fetch guild for ${data.discord_id}: ${data.guild_id}`,
      );
      return;
    }

    try {
      const embed = new EmbedBuilder()
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      if (action === "verification_success") {
        const member = await guild.members
          .fetch(data.discord_id)
          .catch(() => null);
        if (!member) {
          logger.debug(
            `Failed to fetch member for ${data.discord_id}: ${data.guild_id}`,
          );
          return;
        }

        // 2. Apply Nickname if one was provided
        if (data.new_nickname !== null) {
          await member.setNickname(data.new_nickname).catch((err) => {
            logger.debug(
              `Failed to set nickname for ${data.discord_id}: ${err}`,
            );
          });
        }

        // 3. Add Roles
        if (data.roles_to_add) {
          for (const roleId of data.roles_to_add) {
            await member.roles
              .add(roleId)
              .catch((err) =>
                logger.debug(
                  `Failed to add role ${roleId} to ${data.discord_id}: ${err}`,
                ),
              );
          }
        }

        // 4. Remove Roles
        if (data.roles_to_remove) {
          for (const roleId of data.roles_to_remove || []) {
            await member.roles
              .remove(roleId)
              .catch((err) =>
                logger.debug(
                  `Failed to remove role ${roleId} from ${data.discord_id}: ${err}`,
                ),
              );
          }
        }

        embed
          .setTitle("Verification Success")
          .setColor(0x22c55e)
          .setFields(
            { name: "User", value: `<@${data.discord_id}>`, inline: false },
            {
              name: "Roles Added",
              value: data.roles_to_add
                ? data.roles_to_add.map((r) => `<@&${r}>`).join(", ")
                : "None",
              inline: false,
            },
            {
              name: "Roles Removed",
              value: data.roles_to_remove
                ? data.roles_to_remove.map((r) => `<@&${r}>`).join(", ")
                : "None",
              inline: false,
            },
          );

        const channel = (await client.channels
          .fetch(data.channel_id)
          .catch(() => null)) as TextChannel;
        if (channel) {
          await channel.send({ embeds: [embed] }).catch(() => null);
        }
      } else if (action === "verification_fail") {
        embed
          .setTitle("Verification Failed")
          .setColor(0xef4444)
          .setFields({
            name: "User",
            value: `<@${data.discord_id}>`,
            inline: false,
          });
        const channel = (await client.channels
          .fetch(data.channel_id)
          .catch(() => null)) as TextChannel;

        await logGuildError(
          data.guild_id,
          client,
          "Verification Failed",
          data.error.message,
          `Failed to verify <@${data.discord_id}>.`,
        );
        if (channel) {
          await channel.send({ embeds: [embed] }).catch(() => null);
        }
      }
      finishSync();
    } catch (error) {
      logger.error("Failed to handle verification event", error);
      await logGuildError(
        data.guild_id,
        client,
        "Verification UI Application Failed",
        error instanceof Error ? error.message : String(error),
        `Failed to apply roles/nickname to <@${data.discord_id}>.`,
      );
    } finally {
      finishSync();
    }
  }
}
