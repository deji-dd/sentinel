import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";

import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../lib/supabase.js";

export const data = new SlashCommandBuilder()
  .setName("guild-status")
  .setDescription(
    "View the status of all initialized guilds and their modules",
  );

export async function execute(
  interaction: ChatInputCommandInteraction,

  client: Client,
): Promise<void> {
  try {
    await interaction.deferReply();

    const adminGuildId = process.env.ADMIN_GUILD_ID;

    // Check if command is being run in admin guild
    if (!interaction.guild || interaction.guild.id !== adminGuildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Admin Only")
        .setDescription(
          "This command can only be run in the admin guild. Contact the bot owner.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get all initialized guilds
    const { data: configuredGuilds, error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id, enabled_modules")
      .order("guild_id", { ascending: true });

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Database Error")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    if (!configuredGuilds || configuredGuilds.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Guild Status")
        .setDescription("No guilds have been initialized yet.")
        .addFields({
          name: "Next Steps",
          value:
            "Use `/add-bot` to get an invite link, add the bot to your guild, then use `/setup-guild` to initialize it.",
        });

      await interaction.editReply({
        embeds: [embed],
      });
      return;
    }

    const embeds: EmbedBuilder[] = [];
    let currentEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Status")
      .setDescription(
        `Showing ${configuredGuilds.length} initialized guild(s):`,
      );

    let fieldCount = 0;
    const maxFieldsPerEmbed = 25; // Discord embed limit

    for (const config of configuredGuilds) {
      const guild = client.guilds.cache.get(config.guild_id);
      const guildName = guild ? guild.name : `Unknown Guild`;
      const guildMemberCount = guild ? guild.memberCount : "?";

      // Get active modules (excluding admin which is always enabled)
      const activeModules = (config.enabled_modules as string[])
        .filter((m) => m !== "admin")
        .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
        .join(", ");

      const moduleStatus = activeModules || "Admin only";
      const availability = guild ? "✅ Bot in guild" : "⚠️ Bot not found";

      currentEmbed.addFields({
        name: `${guildName} (${config.guild_id})`,
        value: `Members: **${guildMemberCount}** | Modules: **${moduleStatus}**\n${availability}`,
        inline: false,
      });

      fieldCount++;

      // Create new embed if we're approaching the limit
      if (fieldCount >= maxFieldsPerEmbed) {
        embeds.push(currentEmbed);
        currentEmbed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("Guild Status (continued)");
        fieldCount = 0;
      }
    }

    // Add the last embed
    if (fieldCount > 0) {
      embeds.push(currentEmbed);
    }

    // Add summary embed if needed
    const summaryEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setFooter({
        text: `Total: ${configuredGuilds.length} guild(s) initialized`,
      })
      .setTimestamp();

    // Move footer to last embed
    if (embeds.length > 0) {
      const lastEmbed = embeds[embeds.length - 1];
      lastEmbed.setFooter({
        text: `Total: ${configuredGuilds.length} guild(s) initialized`,
      });
      lastEmbed.setTimestamp();
    } else {
      embeds.push(summaryEmbed);
    }

    await interaction.editReply({
      embeds: embeds,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in guild-status command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}
