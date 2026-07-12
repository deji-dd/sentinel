/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  REST,
  Routes,
} from "discord.js";
import { GuildConfigs, GuildApiKeys } from "@sentinel/shared";
import { logGuildSuccess } from "../../../lib/guild-logger.js";
import {
  deployAllGuildCommands,
  deployGuildCommands,
} from "../../../lib/deploy-commands-helper.js";

export type AdminInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

if (!botOwnerId) {
  throw new Error("Missing SENTINEL_DISCORD_USER_ID environment variable");
}

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Bot owner administration dashboard");

function getAdminSessionUserId(
  footerText?: string,
  defaultUserId?: string,
): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(/Admin Session:\s*(\d+)/);
  return match ? match[1] : defaultUserId || "";
}

export async function validateAdminInteraction(
  interaction: any,
): Promise<boolean> {
  const isOwner = interaction.user.id === botOwnerId;
  if (!isOwner) {
    const warnEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Access Denied")
      .setDescription(
        "Only the bot owner can interact with this administration session.",
      )
      .setFooter({ text: "Sentinel" })
      .setTimestamp();
    const reply = await interaction.reply({
      embeds: [warnEmbed],
      fetchReply: true,
    });
    setTimeout(() => reply.delete().catch(() => {}), 8000);
    return false;
  }
  return true;
}

function attachAdminTimeoutCollector(message: any): void {
  if (
    !message ||
    typeof message.createMessageComponentCollector !== "function"
  ) {
    return;
  }

  const collector = message.createMessageComponentCollector({
    idle: 900000, // 15 minutes
  });

  collector.on("collect", () => {
    // Reset timer
  });

  collector.on("end", async () => {
    try {
      const msg = await message.fetch().catch(() => null);
      if (!msg) return;

      const allDisabled = msg.components.every((row: any) =>
        row.components.every((c: any) => c.disabled),
      );
      if (allDisabled) return;

      const disabledRows = msg.components.map((row: any) => {
        const newRow = ActionRowBuilder.from(row as any);
        newRow.components.forEach((component: any) => {
          component.setDisabled(true);
        });
        return newRow;
      });

      const originalEmbed = msg.embeds[0];
      if (!originalEmbed) return;

      const timeoutEmbed = EmbedBuilder.from(originalEmbed);
      const currentDesc = originalEmbed.description || "";
      timeoutEmbed.setDescription(
        currentDesc +
          "\n\n*This admin session has timed out due to inactivity and can no longer be edited.*",
      );

      await msg
        .edit({
          embeds: [timeoutEmbed],
          components: disabledRows as any[],
        })
        .catch(() => {});
    } catch (error) {
      console.error("Error in admin timeout collector:", error);
    }
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const isOwner = interaction.user.id === botOwnerId;

  if (!isOwner) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Not Authorized")
      .setDescription("You are not authorized to use this command.")
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    await interaction.reply({
      embeds: [errorEmbed],
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await handleShowMainDashboard(interaction, true);
}

export async function handleShowMainDashboard(
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin Settings")
      .setDescription(
        "Select a setting below to configure guild administration settings.",
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("admin_dashboard_select")
      .setPlaceholder("Select an administration task...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Guild Initialization")
          .setValue("guild_init")
          .setDescription("Initialize a new server's default configuration"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Guild Module Management")
          .setValue("guild_modules")
          .setDescription(
            "Enable or disable configuration modules for a guild",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Guild De-initialization")
          .setValue("guild_deinit")
          .setDescription(
            "De-initialize a server and optionally make bot leave",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Redeploy Commands")
          .setValue("redeploy")
          .setDescription("Redeploy slash commands globally and to all guilds"),
      );

    const selectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const reply = await interaction.editReply({
      embeds: [embed],
      components: [selectRow],
    });

    if (interaction.isChatInputCommand()) {
      attachAdminTimeoutCollector(reply);
    }
  } catch (error) {
    console.error("Error showing admin dashboard:", error);
  }
}

export async function handleAdminDashboardSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const selectedTask = interaction.values[0];

    if (selectedTask === "guild_init") {
      await handleShowGuildInit(interaction, true);
    } else if (selectedTask === "guild_deinit") {
      await handleShowGuildDeinit(interaction, true);
    } else if (selectedTask === "guild_modules") {
      await handleShowGuildModules(interaction, true);
    } else if (selectedTask === "redeploy") {
      await handleShowRedeploy(interaction, true);
    }
  } catch (error) {
    console.error("Error in admin dashboard select handler:", error);
  }
}

export async function handleShowGuildInit(
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const client = interaction.client;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const initializedGuilds = GuildConfigs.findAll();

    const initializedIds = new Set(initializedGuilds.map((g) => g.guild_id));

    const uninitializedGuilds: Array<{ id: string; name: string }> = [];
    for (const [id, guild] of client.guilds.cache.entries()) {
      if (!initializedIds.has(id)) {
        uninitializedGuilds.push({ id, name: guild.name });
      }
    }

    let uninitializedList = "All guilds are initialized!";
    if (uninitializedGuilds.length > 0) {
      uninitializedList = uninitializedGuilds
        .map((g) => `• ${g.name} (${g.id})`)
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin • Guild Initialization")
      .setDescription(
        "Select an uninitialized server from the list below to initialize its configuration, or click Enter Guild ID to input manually.\n\n" +
          "**Uninitialized Servers:**\n" +
          uninitializedList,
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components: any[] = [];

    if (uninitializedGuilds.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("admin_guild_init_select")
        .setPlaceholder("Select a server to initialize...");

      const options = uninitializedGuilds
        .slice(0, 25)
        .map((g) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(g.name.slice(0, 100))
            .setValue(g.id),
        );

      select.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      );
    }

    const enterBtn = new ButtonBuilder()
      .setCustomId("admin_guild_init_modal_btn")
      .setLabel("Enter Guild ID")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(enterBtn, backBtn),
    );

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error in handleShowGuildInit:", error);
  }
}

export async function handleGuildInitSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await interaction.deferUpdate();
  const selectedGuildId = interaction.values[0];
  await handleGuildInitSubmit(selectedGuildId, interaction);
}

export async function handleGuildInitModalBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("admin_guild_init_modal")
      .setTitle("Initialize Server");

    const guildIdInput = new TextInputBuilder()
      .setCustomId("admin_guild_id_input")
      .setLabel("Discord Server ID")
      .setStyle(TextInputStyle.Short)
      .setMinLength(15)
      .setMaxLength(25)
      .setRequired(true)
      .setPlaceholder("Enter Server (Guild) ID");

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      guildIdInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error showing guild init modal:", error);
  }
}

export async function handleGuildInitModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferUpdate();
  const guildId = interaction.fields
    .getTextInputValue("admin_guild_id_input")
    .trim();
  await handleGuildInitSubmit(guildId, interaction);
}

async function handleGuildInitSubmit(
  guildId: string,
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
): Promise<void> {
  try {
    const client = interaction.client;

    let guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) {
      GuildConfigs.insertOne({
        id: guildId,
        guild_id: guildId,
        auto_verify: false,
        nickname_template: "{name} [{id}]",
        verified_role_id: null,
        verified_role_ids: [],
        enabled_modules: ["admin"],
        admin_role_ids: [],
        log_channel_id: null,
        faction_list_channel_id: null,
        faction_list_message_ids: [],
        tt_full_channel_id: null,
        tt_filtered_channel_id: null,
        tt_territory_ids: [],
        tt_faction_ids: [],
      });

      await deployGuildCommands(guildId);

      await logGuildSuccess(
        guildId,
        client,
        "Guild Config Initialized",
        `Guild configuration initialized by bot admin ${interaction.user}.`,
      );
    }

    await handleShowGuildInit(interaction, true);
  } catch (error) {
    console.error("Error in handleGuildInitSubmit:", error);
  }
}

export async function handleShowGuildModules(
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const client = interaction.client;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const initializedGuilds = GuildConfigs.findAll();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin • Guild Module Management")
      .setDescription(
        "Select a server from the dropdown menu below to configure its enabled modules.",
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components: any[] = [];

    if (initializedGuilds.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("admin_guild_modules_guild_select")
        .setPlaceholder("Select a server...");

      const options = initializedGuilds.map((g) => {
        const cachedGuild = client.guilds.cache.get(g.guild_id);
        const name = cachedGuild
          ? cachedGuild.name
          : `Server ID: ${g.guild_id}`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(name.slice(0, 100))
          .setValue(g.guild_id);
      });

      select.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      );
    }

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn),
    );

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error in handleShowGuildModules:", error);
  }
}

export async function handleGuildModulesGuildSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await interaction.deferUpdate();
  const selectedGuildId = interaction.values[0];
  await handleShowGuildModuleConfig(selectedGuildId, interaction, true);
}

export async function handleShowGuildModuleConfig(
  guildId: string,
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const client = interaction.client;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) return;

    const enabledModules: string[] = guildConfig.enabled_modules || [];

    const cachedGuild = client.guilds.cache.get(guildId);
    const name = cachedGuild ? cachedGuild.name : `Server ID: ${guildId}`;

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`Manage Modules • ${name}`)
      .setDescription(`Configure the enabled modules for **${name}** below.`)
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId(`admin_guild_modules_save_select|${guildId}`)
      .setPlaceholder("Select modules to enable/disable...")
      .setMinValues(0)
      .setMaxValues(5)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Admin Settings")
          .setValue("admin")
          .setDescription("Core settings (API keys, logging, admin roles)")
          .setDefault(enabledModules.includes("admin")),
        new StringSelectMenuOptionBuilder()
          .setLabel("Verification Settings")
          .setValue("verify")
          .setDescription("Verify user Discord accounts to Torn API profiles")
          .setDefault(enabledModules.includes("verify")),
        new StringSelectMenuOptionBuilder()
          .setLabel("Territories Settings")
          .setValue("territories")
          .setDescription("Territory watching and notifications.")
          .setDefault(enabledModules.includes("territories")),
        new StringSelectMenuOptionBuilder()
          .setLabel("Bazaar Mug Watcher Settings")
          .setValue("bazaar_mug")
          .setDescription("Bazaar targets live watches and notifications")
          .setDefault(enabledModules.includes("bazaar_mug")),
        new StringSelectMenuOptionBuilder()
          .setLabel("Reaction Roles Settings")
          .setValue("reaction_roles")
          .setDescription("Emoji reaction triggers for roles")
          .setDefault(enabledModules.includes("reaction_roles")),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_guild_modules_back_to_list")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const selectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [selectRow, buttonRow],
    });
  } catch (error) {
    console.error("Error showing guild module config:", error);
  }
}

export async function handleGuildModulesSaveSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.customId.split("|")[1];
    if (!guildId) return;

    const selectedModules = interaction.values;

    const hasOtherModules = selectedModules.some((m) => m !== "admin");
    if (hasOtherModules) {
      const keys = GuildApiKeys.find({ guild_id: guildId });
      if (keys.length === 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("API Key Required")
          .setDescription(
            "Cannot enable modules because this server does not have any Torn API keys configured. " +
              "Please configure at least one API key in the admin/config settings first.",
          )
          .setFooter({ text: "Sentinel" })
          .setTimestamp();

        await interaction.followUp({
          embeds: [errorEmbed],
          ephemeral: true,
        });

        // Re-render modules page with current DB state
        await handleShowGuildModuleConfig(guildId, interaction, true);
        return;
      }
    }

    if (!selectedModules.includes("admin")) {
      selectedModules.push("admin");
    }

    const existing = GuildConfigs.findOne(guildId);
    if (existing) {
      existing.enabled_modules = selectedModules;
      GuildConfigs.insertOne(existing);
    }

    await deployGuildCommands(guildId);

    await handleShowGuildModuleConfig(guildId, interaction, true);
  } catch (error) {
    console.error("Error saving guild modules:", error);
  }
}

export async function handleShowRedeploy(
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin • Redeploy Commands")
      .setDescription(
        "Are you sure you want to redeploy all bot slash commands? This will sync commands across all initialized servers and the admin guild.",
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const confirmBtn = new ButtonBuilder()
      .setCustomId("admin_redeploy_confirm")
      .setLabel("Confirm Redeploy")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleShowRedeploy:", error);
  }
}

export async function handleRedeployConfirm(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const loadingEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Admin • Redeploying Commands")
      .setDescription("Redeploying bot commands to Discord. Please wait...")
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [loadingEmbed],
      components: [],
    });

    const result = await deployAllGuildCommands();

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Redeploy Complete")
      .setDescription(
        `Successfully redeployed commands to Discord.\n\n` +
          `• **Successful Guilds:** ${result.success}\n` +
          `• **Failed Guilds:** ${result.failure}`,
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleRedeployConfirm:", error);
  }
}

export async function handleShowGuildDeinit(
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const client = interaction.client;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const initializedGuilds = GuildConfigs.findAll();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Admin • Guild De-initialization")
      .setDescription(
        "Select an initialized server from the list below to de-initialize its configuration.",
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components: any[] = [];

    if (initializedGuilds.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("admin_guild_deinit_select")
        .setPlaceholder("Select a server to de-initialize...");

      const options = initializedGuilds.slice(0, 25).map((g) => {
        const cachedGuild = client.guilds.cache.get(g.guild_id);
        const name = cachedGuild
          ? cachedGuild.name
          : `Server ID: ${g.guild_id}`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(name.slice(0, 100))
          .setValue(g.guild_id);
      });

      select.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      );
    }

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn),
    );

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error in handleShowGuildDeinit:", error);
  }
}

export async function handleGuildDeinitSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await interaction.deferUpdate();
  const selectedGuildId = interaction.values[0];
  await handleShowGuildDeinitConfirm(selectedGuildId, interaction, true);
}

export async function handleShowGuildDeinitConfirm(
  guildId: string,
  interaction: AdminInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const client = interaction.client;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    const cachedGuild = client.guilds.cache.get(guildId);
    const name = cachedGuild ? cachedGuild.name : `Server ID: ${guildId}`;

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("De-initialize Server")
      .setDescription(
        `Are you sure you want to de-initialize **${name}**? This will delete all module and role configurations from the database.\n\n` +
          `Choose whether to delete config only, or also make the bot leave the server.`,
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const deinitOnlyBtn = new ButtonBuilder()
      .setCustomId(`admin_guild_deinit_confirm_only|${guildId}`)
      .setLabel("De-initialize Only")
      .setStyle(ButtonStyle.Danger);

    const deinitLeaveBtn = new ButtonBuilder()
      .setCustomId(`admin_guild_deinit_confirm_leave|${guildId}`)
      .setLabel("De-initialize & Leave")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_guild_deinit_back_to_list")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      deinitOnlyBtn,
      deinitLeaveBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error showing guild deinit confirm:", error);
  }
}

export async function handleGuildDeinitConfirm(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const [prefix, guildId] = interaction.customId.split("|");
    if (!guildId) return;

    const action = prefix.endsWith("leave") ? "leave" : "only";
    const client = interaction.client;
    const footerText = interaction.message?.embeds?.[0]?.footer?.text;
    const originalUserId = getAdminSessionUserId(
      footerText,
      interaction.user.id,
    );

    // Delete guild config
    GuildConfigs.delete(guildId);

    // If only, clear guild commands
    if (action === "only") {
      const isDev = process.env.NODE_ENV === "development";
      const token = isDev
        ? process.env.DISCORD_BOT_TOKEN_LOCAL
        : process.env.DISCORD_BOT_TOKEN;
      const clientId = isDev
        ? process.env.DISCORD_CLIENT_ID_LOCAL
        : process.env.DISCORD_CLIENT_ID;
      if (token && clientId) {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest
          .put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
          .catch(() => {});
      }
    } else if (action === "leave") {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        await guild.leave().catch(() => {});
      }
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("De-initialization Complete")
      .setDescription(
        action === "leave"
          ? `Successfully de-initialized and left server **${guildId}**.`
          : `Successfully de-initialized server **${guildId}** and cleared commands.`,
      )
      .setFooter({
        text: `Sentinel • Admin Session: ${originalUserId}`,
      })
      .setTimestamp();

    const backBtn = new ButtonBuilder()
      .setCustomId("admin_back_to_main")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleGuildDeinitConfirm:", error);
  }
}
