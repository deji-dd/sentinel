import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type RoleSelectMenuInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { encrypt } from "../../../lib/encryption.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure guild settings");

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("This command can only be used in a guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if guild is configured
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Guild Not Initialized")
        .setDescription(
          "Please contact the bot owner to initialize this guild.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Fetch faction role mappings
    const { data: factionRoles } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId)
      .order("faction_id", { ascending: true });

    // Format faction roles display
    let factionRolesDisplay = "None configured";
    if (factionRoles && factionRoles.length > 0) {
      factionRolesDisplay = factionRoles
        .map((fr) => {
          const rolesMention = fr.role_ids
            .map((roleId: string) => `<@&${roleId}>`)
            .join(", ");
          return `Faction ${fr.faction_id}: ${rolesMention}`;
        })
        .join("\n");
    }

    // Show current config with edit buttons
    const configEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Configuration")
      .setDescription("Current settings for this guild:")
      .addFields(
        {
          name: "API Key",
          value: guildConfig.api_key ? "✅ Configured" : "❌ Not configured",
          inline: true,
        },
        {
          name: "Auto Verify",
          value: guildConfig.auto_verify ? "✅ Enabled" : "❌ Disabled",
          inline: true,
        },
        {
          name: "Nickname Template",
          value: `\`${guildConfig.nickname_template || "{name}#{id}"}\``,
          inline: true,
        },
        {
          name: "Sync Interval",
          value: `${guildConfig.sync_interval_seconds || 3600} seconds (${Math.round((guildConfig.sync_interval_seconds || 3600) / 60)} minutes)`,
          inline: true,
        },
        {
          name: "Enabled Modules",
          value:
            guildConfig.enabled_modules.length > 0
              ? guildConfig.enabled_modules.join(", ")
              : "None",
          inline: false,
        },
        {
          name: "Faction Role Mappings",
          value: factionRolesDisplay,
          inline: false,
        },
      )
      .setFooter({
        text: "Use the buttons below to modify settings",
      });

    const editApiKeyBtn = new ButtonBuilder()
      .setCustomId("config_edit_api_key")
      .setLabel("Set API Key")
      .setStyle(ButtonStyle.Primary);

    const toggleAutoVerifyBtn = new ButtonBuilder()
      .setCustomId("config_toggle_auto_verify")
      .setLabel(
        guildConfig.auto_verify ? "Disable Auto Verify" : "Enable Auto Verify",
      )
      .setStyle(
        guildConfig.auto_verify ? ButtonStyle.Danger : ButtonStyle.Success,
      );

    const editNicknameBtn = new ButtonBuilder()
      .setCustomId("config_edit_nickname")
      .setLabel("Edit Nickname Template")
      .setStyle(ButtonStyle.Secondary);

    const editSyncIntervalBtn = new ButtonBuilder()
      .setCustomId("config_edit_sync_interval")
      .setLabel("Edit Sync Interval")
      .setStyle(ButtonStyle.Secondary);

    const addFactionRoleBtn = new ButtonBuilder()
      .setCustomId("config_add_faction_role")
      .setLabel("Add Faction Role")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕");

    const removeFactionRoleBtn = new ButtonBuilder()
      .setCustomId("config_remove_faction_role")
      .setLabel("Remove Faction Role")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("➖")
      .setDisabled(!factionRoles || factionRoles.length === 0);

    const buttonRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editApiKeyBtn,
      toggleAutoVerifyBtn,
    );

    const buttonRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editNicknameBtn,
      editSyncIntervalBtn,
    );

    const buttonRow3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      addFactionRoleBtn,
      removeFactionRoleBtn,
    );

    await interaction.editReply({
      embeds: [configEmbed],
      components: [buttonRow1, buttonRow2, buttonRow3],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in config command:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for API key button
export async function handleSetApiKeyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    // Show a modal for entering the API key
    const modal = new ModalBuilder()
      .setCustomId("config_api_key_modal")
      .setTitle("Configure Torn API Key");

    const apiKeyInput = new TextInputBuilder()
      .setCustomId("api_key_input")
      .setLabel("Torn API Key")
      .setPlaceholder("Enter your 16-character Torn API key")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(16)
      .setMinLength(16);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      apiKeyInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in set API key button handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for nickname template button
export async function handleEditNicknameButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    // Show a modal for entering the nickname template
    const modal = new ModalBuilder()
      .setCustomId("config_nickname_template_modal")
      .setTitle("Configure Nickname Template");

    const templateInput = new TextInputBuilder()
      .setCustomId("nickname_template_input")
      .setLabel("Nickname Template")
      .setPlaceholder("e.g., {name} | {tag}")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue("{name}#{id}");

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description_input")
      .setLabel("Available Variables")
      .setPlaceholder(
        "{name} = player name\n{id} = Torn player ID\n{tag} = faction tag (e.g., [ABC])",
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(
        "Variables:\n• {name} - Player name\n• {id} - Torn player ID\n• {tag} - Faction tag",
      );

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      templateInput,
    );
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      descriptionInput,
    );
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit nickname button handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for API key modal submission
export async function handleApiKeyModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const apiKey = interaction.fields.getTextInputValue("api_key_input");
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Encrypt the API key
    const encryptedApiKey = encrypt(apiKey);

    // Update guild config with encrypted API key
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ api_key: encryptedApiKey })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Save API Key")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ API Key Configured")
      .setDescription(
        `API key has been securely stored and encrypted.\n\nKey: **${apiKey.slice(0, 4)}****...${apiKey.slice(-4)}**`,
      )
      .setFooter({
        text: "The /verify command can now be used in this guild",
      });

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in API key modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

// Handler for nickname template modal
export async function handleNicknameTemplateModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const template = interaction.fields.getTextInputValue(
      "nickname_template_input",
    );
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Update guild config with new template
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ nickname_template: template })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Save Template")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Nickname Template Updated")
      .setDescription(`Template: **${template}**`)
      .setFooter({
        text: "Template will be applied to verified user nicknames",
      });

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in nickname template modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

// Handler for auto verify toggle button
export async function handleToggleAutoVerifyButton(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get current auto_verify status
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("auto_verify")
      .eq("guild_id", guildId)
      .single();

    if (!guildConfig) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Guild configuration not found.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Toggle the setting
    const newValue = !guildConfig.auto_verify;

    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ auto_verify: newValue })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Update Setting")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Auto Verify Updated")
      .setDescription(
        `Auto verification is now **${newValue ? "enabled" : "disabled"}**`,
      )
      .setFooter({
        text: newValue
          ? "New members will be automatically verified on join"
          : "New members will not be automatically verified",
      });

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in toggle auto verify handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

// Handler for add faction role button
export async function handleAddFactionRoleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    // Show a modal for entering faction ID only
    const modal = new ModalBuilder()
      .setCustomId("config_add_faction_role_modal")
      .setTitle("Add Faction Role Mapping");

    const factionIdInput = new TextInputBuilder()
      .setCustomId("faction_id_input")
      .setLabel("Torn Faction ID")
      .setPlaceholder("Enter the numeric faction ID (e.g., 12345)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      factionIdInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add faction role button handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for remove faction role button
export async function handleRemoveFactionRoleButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    // Show a modal for entering faction ID to remove
    const modal = new ModalBuilder()
      .setCustomId("config_remove_faction_role_modal")
      .setTitle("Remove Faction Role Mapping");

    const factionIdInput = new TextInputBuilder()
      .setCustomId("faction_id_input")
      .setLabel("Torn Faction ID to Remove")
      .setPlaceholder("Enter the faction ID to remove mapping")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      factionIdInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove faction role button handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for add faction role modal submission
export async function handleAddFactionRoleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const factionIdStr =
      interaction.fields.getTextInputValue("faction_id_input");
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Validate faction ID is a number
    const factionId = parseInt(factionIdStr, 10);
    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Invalid Faction ID")
        .setDescription("Faction ID must be a valid number.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Check if faction already has role mapping
    const { data: existingMapping } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("role_ids")
      .eq("guild_id", guildId)
      .eq("faction_id", factionId)
      .single();

    // Show role select menu
    const selectEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🎯 Select Roles")
      .setDescription(
        `Select one or more roles to assign to members of **Faction ${factionId}**`,
      );

    if (existingMapping && existingMapping.role_ids.length > 0) {
      const currentRoles = existingMapping.role_ids
        .map((roleId: string) => `<@&${roleId}>`)
        .join(", ");
      selectEmbed.addFields({
        name: "Current Roles",
        value: currentRoles,
        inline: false,
      });
    }

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`config_faction_role_select_${factionId}`)
      .setPlaceholder("Select roles for this faction")
      .setMinValues(1)
      .setMaxValues(10); // Allow up to 10 roles

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelect,
    );

    await interaction.editReply({
      embeds: [selectEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add faction role modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

// Handler for remove faction role modal submission
export async function handleRemoveFactionRoleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const factionIdStr =
      interaction.fields.getTextInputValue("faction_id_input");
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Validate faction ID is a number
    const factionId = parseInt(factionIdStr, 10);
    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Invalid Faction ID")
        .setDescription("Faction ID must be a valid number.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Delete the faction role mapping
    const { error } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .delete()
      .eq("guild_id", guildId)
      .eq("faction_id", factionId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Remove Mapping")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Faction Role Mapping Removed")
      .setDescription(`Removed role mapping for faction **${factionId}**`)
      .setFooter({
        text: "Existing users will keep their roles",
      });

    await interaction.editReply({
      embeds: [successEmbed],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in remove faction role modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    await interaction.editReply({
      embeds: [errorEmbed],
    });
  }
}

// Handler for role select menu
export async function handleFactionRoleSelect(
  interaction: RoleSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Unable to determine guild.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Extract faction ID from custom ID
    const factionId = parseInt(
      interaction.customId.replace("config_faction_role_select_", ""),
      10,
    );

    if (isNaN(factionId)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("Invalid faction ID.");

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    // Get selected role IDs
    const roleIds = interaction.values;

    // Insert or update the faction role mapping
    const { error } = await supabase.from(TABLE_NAMES.FACTION_ROLES).upsert(
      {
        guild_id: guildId,
        faction_id: factionId,
        role_ids: roleIds,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "guild_id,faction_id",
      },
    );

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Save Mapping")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const rolesMention = roleIds.map((id) => `<@&${id}>`).join(", ");

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Faction Role Mapping Saved")
      .setDescription(
        `Faction **${factionId}** will now be assigned:\n${rolesMention}`,
      )
      .setFooter({
        text: "This will apply to newly verified users",
      });

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in faction role select handler:", errorMsg);
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

// Handler for sync interval button
export async function handleEditSyncIntervalButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    // Show a modal for entering the sync interval
    const modal = new ModalBuilder()
      .setCustomId("config_sync_interval_modal")
      .setTitle("Configure Sync Interval");

    const intervalInput = new TextInputBuilder()
      .setCustomId("sync_interval_input")
      .setLabel("Sync Interval (seconds)")
      .setPlaceholder("e.g., 3600 for 1 hour, 1800 for 30 minutes")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue("3600");

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      intervalInput,
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit sync interval button handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}

// Handler for sync interval modal submission
export async function handleSyncIntervalModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      throw new Error("Guild ID not found");
    }

    const intervalStr = interaction.fields.getTextInputValue(
      "sync_interval_input",
    );
    const interval = parseInt(intervalStr, 10);

    if (isNaN(interval) || interval < 60 || interval > 86400) {
      throw new Error(
        "Sync interval must be between 60 and 86400 seconds (1 minute to 24 hours)",
      );
    }

    // Update guild config
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ sync_interval_seconds: interval })
      .eq("guild_id", guildId);

    if (error) {
      throw error;
    }

    // Ensure sync job exists in sentinel_guild_sync_jobs
    const nextSync = new Date(Date.now() + interval * 1000);
    await supabase.from(TABLE_NAMES.GUILD_SYNC_JOBS).upsert(
      {
        guild_id: guildId,
        next_sync_at: nextSync.toISOString(),
      },
      { onConflict: "guild_id" },
    );

    const successEmbed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("✅ Sync Interval Updated")
      .setDescription(
        `Guild sync interval set to **${interval} seconds** (${Math.round(interval / 60)} minutes)`,
      );

    await interaction.reply({
      embeds: [successEmbed],
      ephemeral: true,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in sync interval modal handler:", errorMsg);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(errorMsg);

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  }
}
