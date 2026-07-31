import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createBaseEmbed, EMBED_COLORS } from "../lib/embeds.js";
import { formatDuration } from "@sentinel/utils";

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Sentinel bot latency and health status."),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const loadingEmbed = createBaseEmbed(
      "Sentinel Diagnostic Ping",
      "Measuring latency...",
      EMBED_COLORS.PRIMARY,
    );

    const response = await interaction.reply({
      embeds: [loadingEmbed],
      withResponse: true,
    });

    const sentMessage = response.resource?.message;
    const latency = sentMessage
      ? sentMessage.createdTimestamp - interaction.createdTimestamp
      : 0;
    const apiPing = Math.max(0, Math.round(interaction.client.ws.ping));
    const uptimeMs = interaction.client.uptime ?? (process.uptime() * 1000);

    const resultEmbed = createBaseEmbed(
      "Sentinel Diagnostic Ping",
      undefined,
      EMBED_COLORS.PRIMARY,
    ).addFields(
      {
        name: "Roundtrip Latency",
        value: `\`${formatDuration(latency)}\``,
        inline: true,
      },
      {
        name: "Discord API Heartbeat",
        value: `\`${formatDuration(apiPing)}\``,
        inline: true,
      },
      {
        name: "Bot Uptime",
        value: `\`${formatDuration(uptimeMs)}\``,
        inline: true,
      },
    );

    await interaction.editReply({ embeds: [resultEmbed] });
  },
};

