/**
 * Reaction Roles module handlers
 * Manages emoji-to-role mappings for self-assignable roles
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../../lib/supabase.js";

interface ReactionRole {
  id: number;
  guild_id: string;
  message_id: string;
  emoji: string;
  role_id: string;
  created_at: string;
}

interface ReactionRoleConfig {
  guild_id: string;
  allowed_role_ids: string[];
}

/**
 * Show reaction roles settings UI
 */
export async function handleShowReactionRolesSettings(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    // Fetch config
    const { data: config } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    // Fetch existing reaction roles
    const { data: reactions } = await supabase
      .from(TABLE_NAMES.REACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId)
      .order("message_id", { ascending: true });

    const allowedRoleIds = config?.allowed_role_ids || [];
    const rolesDisplay =
      allowedRoleIds.length > 0
        ? allowedRoleIds.map((id: string) => `<@&${id}>`).join(", ")
        : "Not configured";

    const reactionEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("⚙️ Reaction Roles Settings")
      .addFields(
        {
          name: "Allowed Roles",
          value: rolesDisplay,
          inline: false,
        },
        {
          name: "Active Mappings",
          value:
            reactions && reactions.length > 0
              ? `${reactions.length} emoji-role mapping${reactions.length !== 1 ? "s" : ""}`
              : "No mappings configured",
          inline: false,
        },
      );

    const editAllowedBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_edit_allowed")
      .setLabel("Edit Allowed Roles")
      .setStyle(ButtonStyle.Primary);

    const createMappingBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_create_mapping")
      .setLabel("Create Emoji-Role Mapping")
      .setStyle(ButtonStyle.Primary);

    const viewMappingsBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_mappings")
      .setLabel("View All Mappings")
      .setStyle(
        reactions && reactions.length > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary,
      )
      .setDisabled(!reactions || reactions.length === 0);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editAllowedBtn,
      createMappingBtn,
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      viewMappingsBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [reactionEmbed],
      components: [row1, row2],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in show reaction roles settings:", errorMsg);
  }
}

/**
 * Handle editing allowed roles
 */
export async function handleEditAllowedRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("👥 Select Allowed Roles")
      .setDescription(
        "Select the roles that can use reaction role self-assignment. Leave empty to allow all members.",
      );

    const roleSelectMenu = new ActionRowBuilder<RoleSelectMenuBuilder>()
      .addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("reaction_roles_allowed_select")
          .setPlaceholder("Select roles...")
          .setMinValues(0)
          .setMaxValues(25),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [roleSelectMenu, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit allowed roles:", errorMsg);
  }
}

/**
 * Handle allowed roles selection
 */
export async function handleAllowedRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const selectedRoles = interaction.values || [];

    if (!guildId) return;

    // Update or create config
    await supabase.from(TABLE_NAMES.REACTION_ROLE_CONFIG).upsert(
      {
        guild_id: guildId,
        allowed_role_ids: selectedRoles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id" },
    );

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Allowed Roles Updated")
      .setDescription(
        selectedRoles.length > 0
          ? `${selectedRoles.length} role(s) can now use reaction roles`
          : "All members can use reaction roles",
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back to Settings")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in allowed roles select:", errorMsg);
  }
}

/**
 * Handle creating emoji-role mapping
 */
export async function handleCreateMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const modal = new ModalBuilder()
      .setCustomId("reaction_roles_create_modal")
      .setTitle("Create Emoji-Role Mapping");

    const messageInput = new TextInputBuilder()
      .setCustomId("message_id_input")
      .setLabel("Message ID")
      .setPlaceholder("e.g., 1234567890123456789")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const emojiInput = new TextInputBuilder()
      .setCustomId("emoji_input")
      .setLabel("Emoji")
      .setPlaceholder("e.g., 🎮 or 👍")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const roleInput = new TextInputBuilder()
      .setCustomId("role_id_input")
      .setLabel("Role ID")
      .setPlaceholder("e.g., 1234567890123456789")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      messageInput,
    );
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      emojiInput,
    );
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      roleInput,
    );

    modal.addComponents(row1, row2, row3);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in create mapping:", errorMsg);
  }
}

/**
 * Handle create mapping modal submission
 */
export async function handleCreateMappingModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const messageId = interaction.fields.getTextInputValue("message_id_input");
    const emoji = interaction.fields.getTextInputValue("emoji_input");
    const roleId = interaction.fields.getTextInputValue("role_id_input");

    // Validate emoji (simple check)
    if (emoji.length > 100) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Invalid Emoji")
        .setDescription("Emoji must be less than 100 characters");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Insert mapping
    const { error } = await supabase
      .from(TABLE_NAMES.REACTION_ROLES)
      .insert({
        guild_id: guildId,
        message_id: messageId,
        emoji: emoji,
        role_id: roleId,
      });

    if (error) {
      if (error.code === "23505") {
        // Unique constraint violation
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Mapping Already Exists")
          .setDescription(
            "This emoji is already mapped for this message. Delete it first.",
          );

        await interaction.editReply({
          embeds: [errorEmbed],
        });
      } else {
        throw error;
      }
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Mapping Created")
      .setDescription(
        `${emoji} → <@&${roleId}>\nMessage ID: ${messageId}`,
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back to Settings")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in create mapping modal:", errorMsg);
  }
}

/**
 * View all reaction role mappings
 */
export async function handleViewMappings(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: reactions } = await supabase
      .from(TABLE_NAMES.REACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId)
      .order("message_id", { ascending: true });

    if (!reactions || reactions.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("No Mappings")
        .setDescription("No emoji-role mappings configured yet.");

      const backBtn = new ButtonBuilder()
        .setCustomId("reaction_roles_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        backBtn,
      );

      await interaction.editReply({
        embeds: [emptyEmbed],
        components: [row],
      });
      return;
    }

    // Group by message ID
    const byMessage = new Map<string, ReactionRole[]>();
    reactions.forEach((r) => {
      if (!byMessage.has(r.message_id)) {
        byMessage.set(r.message_id, []);
      }
      byMessage.get(r.message_id)!.push(r);
    });

    const mappingsEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📋 Emoji-Role Mappings");

    Array.from(byMessage.entries()).forEach(([messageId, rrs]) => {
      const mappings = rrs
        .map((r) => `${r.emoji} → <@&${r.role_id}>`)
        .join("\n");
      mappingsEmbed.addFields({
        name: `Message: ${messageId}`,
        value: mappings,
        inline: false,
      });
    });

    const deleteBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_select_delete")
      .setLabel("Delete Mapping")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      deleteBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [mappingsEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in view mappings:", errorMsg);
  }
}

/**
 * Select mapping to delete
 */
export async function handleSelectDeleteMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: reactions } = await supabase
      .from(TABLE_NAMES.REACTION_ROLES)
      .select("*")
      .eq("guild_id", guildId)
      .order("message_id", { ascending: true });

    if (!reactions || reactions.length === 0) {
      return;
    }

    const options = reactions.slice(0, 25).map((r) => {
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${r.emoji} (${r.message_id})`)
        .setValue(`delete_${r.id}`)
        .setDescription(`Role: <@&${r.role_id}>`);
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("reaction_roles_delete_select")
      .setPlaceholder("Select mapping to delete...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_mappings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      components: [row, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in select delete mapping:", errorMsg);
  }
}

/**
 * Delete selected mapping
 */
export async function handleDeleteMapping(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const selectedValue = interaction.values[0];
    const selectedId = selectedValue.replace("delete_", "");

    const { error } = await supabase
      .from(TABLE_NAMES.REACTION_ROLES)
      .delete()
      .eq("id", selectedId);

    if (error) {
      throw error;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Mapping Deleted")
      .setDescription("The emoji-role mapping has been removed.");

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_mappings")
      .setLabel("Back to Mappings")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backBtn,
    );

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in delete mapping:", errorMsg);
  }
}
