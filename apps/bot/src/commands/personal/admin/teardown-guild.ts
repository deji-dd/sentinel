import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type Client,
  REST,
  Routes,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../lib/supabase.js";

export const data = new SlashCommandBuilder()
  .setName("teardown-guild")
  .setDescription("De-initialize a guild and remove bot integration");

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

    // Get list of configured guilds from database
    const { data: configuredGuilds, error: queryError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id, enabled_modules");

    // Get all guilds the bot is currently in
    const botsGuilds = client.guilds.cache;

    // Combine both lists: configured first, then uninitialized guilds
    const allGuilds = new Map<
      string,
      { id: string; configured: boolean; enabled_modules?: string[] }
    >();

    // Add configured guilds
    if (!queryError && configuredGuilds) {
      for (const config of configuredGuilds) {
        allGuilds.set(config.guild_id, {
          id: config.guild_id,
          configured: true,
          enabled_modules: config.enabled_modules,
        });
      }
    }

    // Add uninitialized guilds (bot is in but not configured)
    for (const [guildId, guild] of botsGuilds) {
      if (!allGuilds.has(guildId)) {
        allGuilds.set(guildId, {
          id: guildId,
          configured: false,
        });
      }
    }

    if (allGuilds.size === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ No Guilds Found")
        .setDescription("Bot is not in any guilds. No teardown needed.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for guild selection, including configuration status
    const guildOptions: StringSelectMenuOptionBuilder[] = [];

    // Add configured guilds first
    for (const [guildId, guildData] of allGuilds) {
      if (guildData.configured) {
        const guild = botsGuilds.get(guildId);
        const guildName = guild ? guild.name : `Unknown Guild (${guildId})`;
        const isInGuild = guild ? "✅" : "❌";

        guildOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${isInGuild} ${guildName.substring(0, 90)} [Configured]`)
            .setValue(guildId)
            .setDescription(`ID: ${guildId}`),
        );
      }
    }

    // Then add uninitialized guilds
    for (const [guildId, guildData] of allGuilds) {
      if (!guildData.configured) {
        const guild = botsGuilds.get(guildId);
        const guildName = guild ? guild.name : `Unknown Guild (${guildId})`;

        guildOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${guildName.substring(0, 90)} [Uninitialized]`)
            .setValue(guildId)
            .setDescription(`ID: ${guildId}`),
        );
      }
    }

    const guildSelectMenu = new StringSelectMenuBuilder()
      .setCustomId("teardown_guild_select")
      .setPlaceholder("Select a guild to remove bot from...")
      .addOptions(guildOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      guildSelectMenu,
    );

    const configuredCount = Array.from(allGuilds.values()).filter(
      (g) => g.configured,
    ).length;
    const uninitializedCount = allGuilds.size - configuredCount;

    let footerText = "";
    if (configuredCount > 0 && uninitializedCount > 0) {
      footerText = `${configuredCount} configured, ${uninitializedCount} uninitialized`;
    } else if (configuredCount > 0) {
      footerText = `${configuredCount} configured guild(s)`;
    } else {
      footerText = `${uninitializedCount} uninitialized guild(s)`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Guild Teardown")
      .setDescription(
        "Select a guild to remove the bot from. Configured guilds will have their data removed.",
      )
      .setFooter({
        text: footerText,
      });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in teardown-guild command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Teardown Failed")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

export async function handleTeardownGuildSelect(
  interaction: StringSelectMenuInteraction,

  client: Client,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const selectedGuildId = interaction.values[0];

    // Check if guild is configured
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("guild_id")
      .eq("guild_id", selectedGuildId)
      .single();

    const isConfigured = !!guildConfig;

    // Try to leave the guild if bot is in it
    const guild = client.guilds.cache.get(selectedGuildId);
    let leftGuildMessage = "";

    if (guild) {
      try {
        await guild.leave();
        leftGuildMessage = "\n✅ Bot has left the guild.";
      } catch (leaveError) {
        const errorMsg =
          leaveError instanceof Error ? leaveError.message : String(leaveError);
        console.error(`Failed to leave guild ${selectedGuildId}:`, errorMsg);
        leftGuildMessage = `\n⚠️ Could not remove bot from guild (${errorMsg})`;

        // Try to deregister commands from the guild instead
        try {
          const isDev = process.env.NODE_ENV === "development";
          const token = isDev
            ? process.env.DISCORD_BOT_TOKEN_LOCAL
            : process.env.DISCORD_BOT_TOKEN;
          const clientId = isDev
            ? process.env.DISCORD_CLIENT_ID_LOCAL
            : process.env.DISCORD_CLIENT_ID;

          if (token && clientId) {
            const rest = new REST({ version: "10" }).setToken(token);
            await rest.put(
              Routes.applicationGuildCommands(clientId, selectedGuildId),
              {
                body: [],
              },
            );
            leftGuildMessage += "\n✅ Guild commands have been cleared.";
          }
        } catch (cmdError) {
          const errorMsg =
            cmdError instanceof Error ? cmdError.message : String(cmdError);
          console.error(
            `Failed to clear guild commands for ${selectedGuildId}:`,
            errorMsg,
          );
          leftGuildMessage += `\n⚠️ Could not clear commands (${errorMsg})`;
        }
      }
    } else {
      leftGuildMessage = "\n⚠️ Bot is no longer in this guild.";
    }

    // Only clean up database records if the guild was configured
    if (isConfigured) {
      // Remove guild config from database
      const { error: deleteConfigError } = await supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .delete()
        .eq("guild_id", selectedGuildId);

      if (deleteConfigError) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Teardown Failed")
          .setDescription(
            `Failed to remove guild configuration: ${deleteConfigError.message}`,
          );

        await interaction.editReply({
          embeds: [errorEmbed],
          components: [],
        });
        return;
      }

      // Remove sync jobs for this guild
      const { error: deleteSyncError } = await supabase
        .from(TABLE_NAMES.GUILD_SYNC_JOBS)
        .delete()
        .eq("guild_id", selectedGuildId);

      if (deleteSyncError) {
        console.error(
          `Warning: Failed to remove sync jobs for guild ${selectedGuildId}:`,
          deleteSyncError.message,
        );
        // Don't fail teardown for this, just log it
      }

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Guild De-Initialized")
        .setDescription(
          `Guild **${selectedGuildId}** has been de-initialized.${leftGuildMessage}`,
        )
        .addFields({
          name: "Cleaned Up",
          value: "• Guild configuration\n• Sync jobs\n• Database records",
        });

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
    } else {
      // Guild was not configured, just removed bot from it
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Bot Removed from Guild")
        .setDescription(
          `Guild **${selectedGuildId}** had no configuration.${leftGuildMessage}`,
        )
        .addFields({
          name: "Action",
          value: "• Bot removed from guild",
        });

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in teardown guild select handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
  }
}
