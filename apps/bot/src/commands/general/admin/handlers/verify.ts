/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { randomUUID } from "crypto";
import { GuildConfigs, FactionRoles, GuildApiKeys } from "@sentinel/shared";

export type ConfigInteraction =
  | StringSelectMenuInteraction
  | ButtonInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | ModalSubmitInteraction;

function getConfigSessionUserId(
  footerText?: string,
  defaultUserId?: string,
): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(/Config Session:\s*(\d+)/);
  return match ? match[1] : defaultUserId || "";
}

function isTruthyBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

export async function handleShowVerifySettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) return;

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Verification Settings")
      .setDescription(
        "Configure user Discord-to-Torn verification settings below.",
      )

      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("config_verify_setting_select")
      .setPlaceholder("Select a setting to edit...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Toggle Auto-Verification")
          .setValue("toggle_auto_verify")
          .setDescription("Toggle processing members on join"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Edit Nickname Template")
          .setValue("edit_nickname_template")
          .setDescription("Change the automatic nickname format"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Verified Roles")
          .setValue("set_verified_roles")
          .setDescription("Add or remove general verified roles"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Faction List Channel")
          .setValue("set_faction_list_channel")
          .setDescription("Channel to post/update faction listings"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Manage Faction Mappings")
          .setValue("manage_faction_mappings")
          .setDescription("Map factions to member and leader roles"),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error showing verify settings:", error);
  }
}

export async function handleVerifySettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    const guildId = interaction.guildId;
    if (!guildId) return;

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    if (selected === "toggle_auto_verify") {
      await handleShowAutoVerifySettings(interaction);
    } else if (selected === "edit_nickname_template") {
      await handleShowNicknameTemplateSettings(interaction);
    } else if (selected === "set_verified_roles") {
      await interaction.deferUpdate();
      // Show Role Select Menu
      const config = GuildConfigs.findOne(guildId);

      const existingRoles = parseTextArray(config?.verified_role_ids);

      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("Set Verified Roles")
        .setDescription(
          "Select the general roles that verified users should get.",
        )
        .setFooter({
          text: `Sentinel • Config Session: ${originalUserId}`,
        })
        .setTimestamp();

      const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId("config_verify_roles_select")
        .setPlaceholder("Select verified roles...")
        .setMinValues(0)
        .setMaxValues(10);

      if (existingRoles.length > 0) {
        roleSelect.setDefaultRoles(existingRoles);
      }

      const backBtn = new ButtonBuilder()
        .setCustomId("config_verify_back_to_settings")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary);

      const rowSelect =
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
      const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
        backBtn,
      );

      await interaction.editReply({
        embeds: [embed],
        components: [rowSelect, rowBtn],
      });
    } else if (selected === "set_faction_list_channel") {
      await interaction.deferUpdate();
      // Show Channel Select Menu
      const config = GuildConfigs.findOne(guildId);

      const existingChannel = config?.faction_list_channel_id;

      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("Set Faction List Channel")
        .setDescription(
          "Select the channel where the faction mappings listing will be published.",
        )
        .setFooter({
          text: `Sentinel • Config Session: ${originalUserId}`,
        })
        .setTimestamp();

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId("config_verify_channel_select")
        .setPlaceholder("Select a channel...")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1);

      if (existingChannel) {
        channelSelect.setDefaultChannels([existingChannel]);
      }

      const backBtn = new ButtonBuilder()
        .setCustomId("config_verify_back_to_settings")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary);

      const rowSelect =
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          channelSelect,
        );
      const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
        backBtn,
      );

      await interaction.editReply({
        embeds: [embed],
        components: [rowSelect, rowBtn],
      });
    } else if (selected === "manage_faction_mappings") {
      await handleShowFactionMappings(interaction);
    } else if (selected === "back_to_modules") {
      const { handleBackToMenu } = await import("../config.js");
      await handleBackToMenu(interaction as any);
    }
  } catch (error) {
    console.error("Error in handleVerifySettingSelect:", error);
  }
}

export async function handleVerifyNicknameModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const template = interaction.fields
      .getTextInputValue("nickname_template_input")
      .trim();

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.nickname_template = template;
      GuildConfigs.update(c);
    }

    await handleShowNicknameTemplateSettings(interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyNicknameModalSubmit:", error);
  }
}

export async function handleVerifyRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const roleIds = interaction.values;

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.verified_role_ids = roleIds;
      GuildConfigs.update(c);
    }

    await handleShowVerifySettings(interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyRolesSelect:", error);
  }
}

export async function handleVerifyChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const channelId = interaction.values[0] || null;

    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.faction_list_channel_id = channelId;
      GuildConfigs.update(c);
    }

    // Trigger update of faction list channel
    const { updateFactionList } =
      await import("../../../../lib/faction-list-manager.js");
    await updateFactionList(guildId, interaction.client);

    await handleShowVerifySettings(interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyChannelSelect:", error);
  }
}

export async function handleShowFactionMappings(
  interaction: ConfigInteraction,
  page = 0,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    // Fetch mappings
    const mappings = FactionRoles.find({ guild_id: guildId });

    const itemsPerPage = 10;
    const totalPages = Math.ceil(mappings.length / itemsPerPage);
    const currentPage = Math.max(
      0,
      Math.min(page, Math.max(0, totalPages - 1)),
    );

    let mappingsDesc = "No faction mappings configured yet.";
    if (mappings.length > 0) {
      const pageMappings = mappings.slice(
        currentPage * itemsPerPage,
        (currentPage + 1) * itemsPerPage,
      );
      mappingsDesc = pageMappings
        .map((m) => {
          const enabledStr = m.enabled ? "Enabled" : "Disabled";
          const name = m.faction_name || `Faction ${m.faction_id}`;
          return `• **${name}** (${m.faction_id}) - ${enabledStr}`;
        })
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Faction Mappings")
      .setDescription(
        "Factions mapped to Discord roles. If a verified member is in a mapped faction, they will get its roles automatically.\n\n" +
          `**Current Mappings (Page ${mappings.length > 0 ? currentPage + 1 : 0} of ${totalPages}):**\n` +
          mappingsDesc,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const components = [];

    if (mappings.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("config_verify_faction_select")
        .setPlaceholder("Select a faction to edit...");

      const pageMappings = mappings.slice(
        currentPage * itemsPerPage,
        (currentPage + 1) * itemsPerPage,
      );
      const options = pageMappings.map((m) => {
        const name = m.faction_name || `Faction ${m.faction_id}`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(name.slice(0, 100))
          .setValue(`edit_faction|${m.faction_id}`);
      });
      select.addOptions(options);

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      );
    }

    const addBtn = new ButtonBuilder()
      .setCustomId("config_verify_add_faction_btn")
      .setLabel("Add/Edit Faction")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_verify_back_to_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
      addBtn,
      backBtn,
    );

    if (totalPages > 1) {
      const prevBtn = new ButtonBuilder()
        .setCustomId(`config_verify_mappings_page|${currentPage - 1}`)
        .setLabel("Previous Page")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0);

      const nextBtn = new ButtonBuilder()
        .setCustomId(`config_verify_mappings_page|${currentPage + 1}`)
        .setLabel("Next Page")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === totalPages - 1);

      rowBtn.addComponents(prevBtn, nextBtn);
    }

    components.push(rowBtn);

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (error) {
    console.error("Error in handleShowFactionMappings:", error);
  }
}

export async function handleVerifyMappingsPage(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const page = parseInt(interaction.customId.split("|")[1]!, 10);
    await handleShowFactionMappings(interaction, page, true);
  } catch (error) {
    console.error("Error in handleVerifyMappingsPage:", error);
  }
}

export async function handleVerifyFactionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    const guildId = interaction.guildId;
    if (!guildId) return;

    if (selected.startsWith("edit_faction|")) {
      await interaction.deferUpdate();
      const factionId = parseInt(selected.split("|")[1]!, 10);
      await handleShowEditFactionMapping(factionId, interaction, true);
    }
  } catch (error) {
    console.error("Error in handleVerifyFactionSelect:", error);
  }
}

export async function handleVerifyAddFactionModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const factionIdStr = interaction.fields
      .getTextInputValue("faction_id_input")
      .trim();
    const factionId = parseInt(factionIdStr, 10);

    if (isNaN(factionId)) {
      await interaction.followUp({
        content: "Invalid Faction ID. Please enter a valid number.",
        ephemeral: true,
      });
      return;
    }

    let factionName = `Faction ${factionId}`;

    // Fetch details from Torn API if possible to resolve name
    const apiKeysList = GuildApiKeys.find({ guild_id: guildId });
    const apiKeys = apiKeysList.length > 0 ? ["dummy"] : [];
    if (apiKeys.length > 0) {
      try {
        const { validateAndFetchFactionDetails } =
          await import("@sentinel/shared");
        const details = await validateAndFetchFactionDetails(
          factionId,
          apiKeys[0],
        );
        if (details && details.data.name) {
          factionName = details.data.name;
        }
      } catch (err) {
        console.warn(`Failed to fetch faction details from Torn API: ${err}`);
      }
    }

    // Check if mapping already exists
    const existing = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];

    if (!existing) {
      // Insert new mapping
      FactionRoles.insertOne({
        id: randomUUID(),
        guild_id: guildId,
        faction_id: factionId,
        faction_name: factionName,
        member_role_ids: [],
        leader_role_ids: [],
        enabled: true,
      });

      // Trigger update of faction list channel
      const { updateFactionList } =
        await import("../../../../lib/faction-list-manager.js");
      await updateFactionList(guildId, interaction.client);
    } else {
      // Just update name if it changed
      const r = FactionRoles.find({
        guild_id: guildId,
        faction_id: factionId,
      })[0];
      if (r) {
        r.faction_name = factionName;
        FactionRoles.update(r);
      }
    }

    await handleShowEditFactionMapping(factionId, interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyAddFactionModalSubmit:", error);
  }
}

export async function handleShowEditFactionMapping(
  factionId: number,
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const mapping = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];

    if (!mapping) return;

    const enabled = mapping.enabled;
    const name = mapping.faction_name || `Faction ${factionId}`;
    const memberRoleIds = parseTextArray(mapping.member_role_ids);
    const leaderRoleIds = parseTextArray(mapping.leader_role_ids);

    const membersDisplay =
      memberRoleIds.length > 0
        ? memberRoleIds.map((id) => `<@&${id}>`).join(", ")
        : "None configured";

    const leadersDisplay =
      leaderRoleIds.length > 0
        ? leaderRoleIds.map((id) => `<@&${id}>`).join(", ")
        : "None configured";

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`Edit Mapping • ${name}`)
      .setDescription(`Configure roles for **${name}** [${factionId}].`)
      .addFields(
        {
          name: "Status",
          value: enabled
            ? "Enabled (Roles will sync)"
            : "Disabled (No syncing)",
          inline: true,
        },
        {
          name: "Member Roles",
          value: membersDisplay,
          inline: false,
        },
        {
          name: "Leader / Co-leader Roles",
          value: leadersDisplay,
          inline: false,
        },
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId(`config_verify_faction_action_select|${factionId}`)
      .setPlaceholder("Select an action...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(enabled ? "Disable Syncing" : "Enable Syncing")
          .setValue("toggle_enabled")
          .setDescription("Toggle syncing roles for this faction"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Member Roles")
          .setValue("set_members")
          .setDescription("Select Discord roles for faction members"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Set Leader Roles")
          .setValue("set_leaders")
          .setDescription(
            "Select Discord roles for faction leaders/co-leaders",
          ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Delete Mapping")
          .setValue("delete_mapping")
          .setDescription("Remove this faction mapping configuration"),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("config_verify_back_to_mappings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error in handleShowEditFactionMapping:", error);
  }
}

export async function handleVerifyFactionActionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    const guildId = interaction.guildId;
    const factionId = parseInt(interaction.customId.split("|")[1]!, 10);
    if (!guildId || isNaN(factionId)) return;

    if (selected === "toggle_enabled") {
      await interaction.deferUpdate();
      const mapping = FactionRoles.find({
        guild_id: guildId,
        faction_id: factionId,
      })[0];

      const current = mapping?.enabled;
      const r = FactionRoles.find({
        guild_id: guildId,
        faction_id: factionId,
      })[0];
      if (r) {
        r.enabled = !current;
        FactionRoles.update(r);
      }

      // Trigger update of faction list channel
      const { updateFactionList } =
        await import("../../../../lib/faction-list-manager.js");
      await updateFactionList(guildId, interaction.client);

      await handleShowEditFactionMapping(factionId, interaction, true);
    } else if (selected === "set_members") {
      await handleVerifyFactionSetMembers(factionId, interaction);
    } else if (selected === "set_leaders") {
      await handleVerifyFactionSetLeaders(factionId, interaction);
    } else if (selected === "delete_mapping") {
      await interaction.deferUpdate();
      const r = FactionRoles.find({
        guild_id: guildId,
        faction_id: factionId,
      })[0];
      if (r) {
        FactionRoles.delete(r.id);
      }

      // Trigger update of faction list channel
      const { updateFactionList } =
        await import("../../../../lib/faction-list-manager.js");
      await updateFactionList(guildId, interaction.client);

      await handleShowFactionMappings(interaction, 0, true);
    }
  } catch (error) {
    console.error("Error in handleVerifyFactionActionSelect:", error);
  }
}

export async function handleVerifyFactionSetMembers(
  factionId: number,
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }
    const guildId = interaction.guildId;
    if (!guildId) return;

    const mapping = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];

    const existingRoles = parseTextArray(mapping?.member_role_ids);
    const name = mapping?.faction_name || `Faction ${factionId}`;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`Set Member Roles • ${name}`)
      .setDescription(
        `Select the roles that members of **${name}** should get.`,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_verify_faction_members_select|${factionId}`)
      .setPlaceholder("Select roles...")
      .setMinValues(0)
      .setMaxValues(10);

    if (existingRoles.length > 0) {
      roleSelect.setDefaultRoles(existingRoles);
    }

    const backBtn = new ButtonBuilder()
      .setCustomId(`config_verify_faction_back_to_edit|${factionId}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error in handleVerifyFactionSetMembers:", error);
  }
}

export async function handleVerifyFactionMembersSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    const factionId = parseInt(interaction.customId.split("|")[1]!, 10);
    if (!guildId || isNaN(factionId)) return;

    const roleIds = interaction.values;

    const r = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];
    if (r) {
      r.member_role_ids = roleIds;
      FactionRoles.update(r);
    }

    await handleShowEditFactionMapping(factionId, interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyFactionMembersSelect:", error);
  }
}

export async function handleVerifyFactionSetLeaders(
  factionId: number,
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }
    const guildId = interaction.guildId;
    if (!guildId) return;

    const mapping = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];

    const existingRoles = parseTextArray(mapping?.leader_role_ids);
    const name = mapping?.faction_name || `Faction ${factionId}`;
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`Set Leader Roles • ${name}`)
      .setDescription(
        `Select the roles that Leaders and Co-leaders of **${name}** should get.`,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_verify_faction_leaders_select|${factionId}`)
      .setPlaceholder("Select roles...")
      .setMinValues(0)
      .setMaxValues(10);

    if (existingRoles.length > 0) {
      roleSelect.setDefaultRoles(existingRoles);
    }

    const backBtn = new ButtonBuilder()
      .setCustomId(`config_verify_faction_back_to_edit|${factionId}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [rowSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error in handleVerifyFactionSetLeaders:", error);
  }
}

export async function handleVerifyFactionLeadersSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    const factionId = parseInt(interaction.customId.split("|")[1]!, 10);
    if (!guildId || isNaN(factionId)) return;

    const roleIds = interaction.values;

    const r = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];
    if (r) {
      r.leader_role_ids = roleIds;
      FactionRoles.update(r);
    }

    await handleShowEditFactionMapping(factionId, interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyFactionLeadersSelect:", error);
  }
}

export async function handleVerifyFactionDelete(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    const factionId = parseInt(interaction.customId.split("|")[1]!, 10);
    if (!guildId || isNaN(factionId)) return;

    const r = FactionRoles.find({
      guild_id: guildId,
      faction_id: factionId,
    })[0];
    if (r) {
      FactionRoles.delete(r.id);
    }

    // Trigger update of faction list channel
    const { updateFactionList } =
      await import("../../../../lib/faction-list-manager.js");
    await updateFactionList(guildId, interaction.client);

    await handleShowFactionMappings(interaction, 0, true);
  } catch (error) {
    console.error("Error in handleVerifyFactionDelete:", error);
  }
}

export async function handleVerifyFactionBackToEdit(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const factionId = parseInt(interaction.customId.split("|")[1]!, 10);
    if (isNaN(factionId)) return;
    await handleShowEditFactionMapping(factionId, interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyFactionBackToEdit:", error);
  }
}

export async function handleShowAutoVerifySettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) return;

    const autoVerify = isTruthyBoolean(guildConfig.auto_verify);
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Auto-Verification Settings")
      .setDescription(
        "Choose whether to automatically process and verify members when they join the server.\n\n" +
          `**Current Status:** ${autoVerify ? "Enabled (process members on join)" : "Disabled"}`,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const toggleBtn = new ButtonBuilder()
      .setCustomId("config_verify_toggle_auto_verify_btn")
      .setLabel(autoVerify ? "Disable" : "Enable")
      .setStyle(autoVerify ? ButtonStyle.Danger : ButtonStyle.Success);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_verify_back_to_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      toggleBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleShowAutoVerifySettings:", error);
  }
}

export async function handleVerifyToggleAutoVerifyBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const current = isTruthyBoolean(config?.auto_verify);
    const c = GuildConfigs.findOne(guildId);
    if (c) {
      c.auto_verify = !current;
      GuildConfigs.update(c);
    }

    await handleShowAutoVerifySettings(interaction, true);
  } catch (error) {
    console.error("Error in handleVerifyToggleAutoVerifyBtn:", error);
  }
}

export async function handleShowNicknameTemplateSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) return;

    const template = guildConfig.nickname_template || "{name} [{id}]";
    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Nickname Template Settings")
      .setDescription(
        "Set the template used to automatically format the nickname of verified members.\n\n" +
          `**Current Template:** \`${template}\`\n\n` +
          "**Available Placeholders:**\n" +
          "• `{name}` - Torn user name\n" +
          "• `{id}` - Torn user ID\n" +
          "• `{tag}` - Faction tag (if member belongs to mapped faction)",
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const editBtn = new ButtonBuilder()
      .setCustomId("config_verify_edit_nickname_btn")
      .setLabel("Edit Template")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_verify_back_to_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleShowNicknameTemplateSettings:", error);
  }
}

export async function handleVerifyEditNicknameBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = GuildConfigs.findOne(guildId);

    const modal = new ModalBuilder()
      .setCustomId("config_verify_nickname_modal")
      .setTitle("Edit Nickname Template");

    const input = new TextInputBuilder()
      .setCustomId("nickname_template_input")
      .setLabel("Nickname Template (use {name}, {id}, {tag})")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(32)
      .setRequired(true)
      .setValue(config?.nickname_template || "{name} [{id}]");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in handleVerifyEditNicknameBtn:", error);
  }
}

export async function handleVerifyAddFactionBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("config_verify_add_faction_modal")
      .setTitle("Add/Edit Faction Mapping");

    const idInput = new TextInputBuilder()
      .setCustomId("faction_id_input")
      .setLabel("Torn Faction ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("e.g. 1234");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(idInput),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in handleVerifyAddFactionBtn:", error);
  }
}
