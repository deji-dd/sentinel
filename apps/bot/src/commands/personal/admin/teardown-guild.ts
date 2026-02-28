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

    if (queryError || !configuredGuilds || configuredGuilds.length === 0) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ No Configured Guilds")
        .setDescription("No guilds are currently configured.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Create select menu for guild selection, including bot presence status
    const guildOptions = configuredGuilds.map((config) => {
      const guild = client.guilds.cache.get(config.guild_id);
      const guildName = guild
        ? guild.name
        : `Unknown Guild (${config.guild_id})`;
      const isInGuild = guild ? "✅" : "❌";

      return new StringSelectMenuOptionBuilder()
        .setLabel(`${isInGuild} ${guildName.substring(0, 95)}`)
        .setValue(config.guild_id)
        .setDescription(`ID: ${config.guild_id}`);
    });

    const guildSelectMenu = new StringSelectMenuBuilder()
      .setCustomId("teardown_guild_select")
      .setPlaceholder("Select a guild to de-initialize...")
      .addOptions(guildOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      guildSelectMenu,
    );

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Guild Teardown")
      .setDescription(
        "Select a guild to de-initialize and remove bot integration. ✅ = Bot is in guild, ❌ = Bot left",
      )
      .setFooter({
        text: `${configuredGuilds.length} configured guild(s)`,
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
