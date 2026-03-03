/**
 * Reaction Roles module handlers
 * Manages emoji-to-role mappings for self-assignable roles
 * Bot posts messages with reactions that users can click
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
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../../lib/supabase.js";

/**
 * Show reaction roles settings UI
 */
export async function handleShowReactionRolesSettings(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    console.log(`[Reaction Roles] Loading settings for guild: ${guildId}`);

    // Fetch config
    const { data: config } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_CONFIG)
      .select("*")
      .eq("guild_id", guildId)
      .single();

    // Fetch existing reaction role messages (only posted ones, exclude pending)
    const { data: messages } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("guild_id", guildId)
      .filter("message_id", "not.ilike", "pending_%")
      .order("created_at", { ascending: false });

    console.log(
      `[Reaction Roles] Found ${messages?.length || 0} posted messages for guild ${guildId}`,
    );

    const allowedRoleIds = config?.allowed_role_ids || [];
    const rolesDisplay =
      allowedRoleIds.length > 0
        ? allowedRoleIds.map((id: string) => `<@&${id}>`).join(", ")
        : "Not configured";

    const reactionEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Reaction Roles Settings")
      .addFields(
        {
          name: "Allowed Roles",
          value: rolesDisplay,
          inline: false,
        },
        {
          name: "Active Messages",
          value:
            messages && messages.length > 0
              ? `${messages.length} reaction role message${messages.length !== 1 ? "s" : ""}`
              : "No messages posted yet",
          inline: false,
        },
      );

    const editAllowedBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_edit_allowed")
      .setLabel("Edit Allowed Roles")
      .setStyle(ButtonStyle.Primary);

    const createMessageBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_create_message")
      .setLabel("Create Reaction Message")
      .setStyle(ButtonStyle.Primary);

    const viewMessagesBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_messages")
      .setLabel("View Messages")
      .setStyle(
        messages && messages.length > 0
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      )
      .setDisabled(!messages || messages.length === 0);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editAllowedBtn,
      createMessageBtn,
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      viewMessagesBtn,
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

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("👥 Select Allowed Roles")
      .setDescription(
        "Select the roles that can use reaction role self-assignment. Leave empty to allow all members.",
      );

    const roleSelectMenu =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
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

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

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
 * Start creating a reaction role message
 */
export async function handleCreateMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📋 Select Channel")
      .setDescription(
        "Choose the channel where the reaction role message will be posted.",
      );

    const channelSelectMenu = new ActionRowBuilder<
      import("discord.js").ChannelSelectMenuBuilder
    >().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("reaction_roles_channel_select")
        .setPlaceholder("Select a channel...")
        .addChannelTypes(ChannelType.GuildText),
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
      components: [channelSelectMenu, buttonRow],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in create message:", errorMsg);
  }
}

/**
 * Handle channel selection and move to embed setup
 */
export async function handleChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    const selectedChannelId = interaction.values[0];
    const guildId = interaction.guildId;
    if (!guildId) return;

    // Create the message record in database first (with unique temporary message_id)
    // Use a combination of timestamp and user ID to ensure uniqueness
    const tempMessageId = `pending_${Date.now()}_${interaction.user.id}`;

    const { data: messageRecord, error: insertError } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .insert({
        guild_id: guildId,
        channel_id: selectedChannelId,
        message_id: tempMessageId,
        title: "Loading...",
        description: null,
      })
      .select()
      .single();

    if (insertError || !messageRecord) {
      console.error("Error creating message record:", insertError);
      return;
    }

    // Show modal for embed details
    const modal = new ModalBuilder()
      .setCustomId(`reaction_roles_create_embed_modal|${messageRecord.id}`)
      .setTitle("Create Reaction Role Message");

    const titleInput = new TextInputBuilder()
      .setCustomId("embed_title")
      .setLabel("Message Title (Optional)")
      .setPlaceholder("Leave empty for default: 'Select Your Roles'")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256);

    const descriptionInput = new TextInputBuilder()
      .setCustomId("embed_description")
      .setLabel("Custom Description (Optional)")
      .setPlaceholder("Leave empty for auto-generated role list")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      titleInput,
    );
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      descriptionInput,
    );

    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in channel select:", errorMsg);
  }
}

/**
 * Handle embed details modal submission
 */
export async function handleCreateEmbedModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const recordIdStr = customIdParts[1];
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const title = interaction.fields.getTextInputValue("embed_title").trim() || "Select Your Roles";
    const description =
      interaction.fields.getTextInputValue("embed_description").trim() || null;

    // Update the message record with details
    await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .update({ title, description })
      .eq("id", recordId);

    // Show UI for adding mappings
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("➕ Add Emoji-Role Pairs")
      .setDescription(
        "Add emoji-role mapping pairs. Configure which emoji maps to which role.",
      );

    const createMappingBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_add_mapping|${recordId}`)
      .setLabel("Add Mapping")
      .setStyle(ButtonStyle.Primary);

    const postMessageBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_post_message|${recordId}`)
      .setLabel("Post Message")
      .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_cancel_create")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createMappingBtn,
      postMessageBtn,
      cancelBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in create embed modal:", errorMsg);
  }
}

/**
 * Add an emoji-role mapping
 */
export async function handleAddMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const messageIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(messageIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`reaction_role_mapping_emoji_modal|${recordId}`)
      .setTitle("Add Emoji-Role Mapping");

    const emojiInput = new TextInputBuilder()
      .setCustomId("emoji_input")
      .setLabel("Emoji")
      .setPlaceholder("e.g., 🎮 or 👍")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(
      emojiInput,
    );

    modal.addComponents(row1);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in add mapping:", errorMsg);
  }
}

/**
 * Validate if a string is a valid Discord emoji
 */
function isValidEmoji(emoji: string): boolean {
  // Standard emoji regex pattern (Unicode emoji only, no ASCII)
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+$/u;
  if (!emojiRegex.test(emoji)) {
    return false;
  }
  // Make sure it's not too long
  if (emoji.length > 10) {
    return false;
  }
  // Check if it contains only emoji-like characters
  return true;
}

/**
 * Handle emoji modal submission - shows role selector
 */
export async function handleMappingEmojiModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferReply();

    const customIdParts = interaction.customId.split("|");
    const recordIdStr = customIdParts[1];
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const emoji = interaction.fields.getTextInputValue("emoji_input").trim();

    // Validate emoji
    if (!isValidEmoji(emoji)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Invalid Emoji")
        .setDescription(
          "Please enter a valid emoji (e.g., 🎮, 👍)\n\nCustom emojis and invalid characters are not supported.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get the message record to ensure it exists
    const { data: messageRecord } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("id", recordId)
      .single();

    if (!messageRecord) {
      return;
    }

    // Show role selector with emoji context
    const instructionEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select Role")
      .setDescription(`Choose which role the ${emoji} emoji should assign:`);

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`reaction_role_mapping_role_select|${recordId}|${emoji}`)
      .setPlaceholder("Choose a role");

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      roleSelect,
    );

    await interaction.editReply({
      embeds: [instructionEmbed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleMappingEmojiModal:", error);
  }
}

/**
 * Handle mapping role selector submission
 */
export async function handleMappingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const recordIdStr = customIdParts[1];
    const emoji = customIdParts.slice(2).join("|"); // In case emoji contains |
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const selectedRoleId = interaction.values[0];

    // Get the message record
    const { data: messageRecord } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("id", recordId)
      .single();

    if (!messageRecord) {
      return;
    }

    // Use the actual message_id from the record (already unique)
    const currentMessageId = messageRecord.message_id;

    // Insert the mapping
    const { error } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .insert({
        message_id: currentMessageId,
        emoji,
        role_id: selectedRoleId,
      });

    if (error) {
      if (error.code === "23505") {
        // Unique constraint violation
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Emoji Already Mapped")
          .setDescription("This emoji is already mapped for this message.");

        await interaction.editReply({
          embeds: [errorEmbed],
          components: [],
        });
      } else {
        throw error;
      }
      return;
    }

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Mapping Added")
      .setDescription(`${emoji} → <@&${selectedRoleId}>`);

    const continueBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_add_mapping|${recordId}`)
      .setLabel("Add Another")
      .setStyle(ButtonStyle.Primary);

    const postBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_post_message|${recordId}`)
      .setLabel("Post Message")
      .setStyle(ButtonStyle.Success);

    const backBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_cancel_create|${recordId}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      continueBtn,
      postBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in mapping role select:", errorMsg);
  }
}

/**
 * Post the reaction role message
 */
export async function handlePostMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const messageIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(messageIdStr, 10);

    if (isNaN(recordId)) {
      console.error("Invalid recordId in handlePostMessage");
      return;
    }

    console.log(`[Reaction Roles] Posting message for recordId: ${recordId}`);

    // Get message record and mappings
    const { data: messageRecord } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("id", recordId)
      .single();

    if (!messageRecord) {
      console.error(
        `[Reaction Roles] Message record not found for id: ${recordId}`,
      );
      return;
    }

    console.log(`[Reaction Roles] Found message record:`, messageRecord);

    // Get mappings for this message
    const { data: tempMappings } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .select("*")
      .eq("message_id", messageRecord.message_id)
      .order("created_at", { ascending: true });

    const mappings = tempMappings || [];
    console.log(
      `[Reaction Roles] Found ${mappings.length} mappings for message_id: ${messageRecord.message_id}`,
    );

    if (mappings.length === 0) {
      const warningEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ No Mappings")
        .setDescription(
          "Please add at least one emoji-role mapping before posting.",
        );

      await interaction.editReply({
        embeds: [warningEmbed],
      });
      return;
    }

    // Get the channel and post the message
    const channel = await interaction.client.channels.fetch(
      messageRecord.channel_id,
    );

    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Channel Not Found")
        .setDescription("The selected channel could not be accessed.");

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Build the embed with auto-generated role mappings
    let finalDescription = messageRecord.description || "React with the emojis below to assign yourself roles:";
    
    // Append emoji-role mapping list
    finalDescription += "\n\n";
    for (const mapping of mappings) {
      finalDescription += `${mapping.emoji} → <@&${mapping.role_id}>\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(messageRecord.title)
      .setDescription(finalDescription);

    // Post the message
    const postedMessage = await channel.send({ embeds: [embed] });
    console.log(`[Reaction Roles] Posted message with ID: ${postedMessage.id}`);

    // Add reactions
    const failedEmojis: string[] = [];
    for (const mapping of mappings) {
      try {
        if (!isValidEmoji(mapping.emoji)) {
          failedEmojis.push(mapping.emoji);
          console.warn(
            `Skipping invalid emoji ${mapping.emoji} for reaction roles`,
          );
          continue;
        }
        await postedMessage.react(mapping.emoji);
      } catch (error) {
        failedEmojis.push(mapping.emoji);
        console.error(`Failed to add reaction ${mapping.emoji}:`, error);
      }
    }

    // Update the message record with the actual message ID
    const { error: updateMessageError } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .update({ message_id: postedMessage.id })
      .eq("id", recordId);

    if (updateMessageError) {
      console.error("Error updating message record:", updateMessageError);
    } else {
      console.log(
        `[Reaction Roles] Updated message record id=${recordId} with message_id=${postedMessage.id}`,
      );
    }

    // Update all mappings to use the actual message ID (batch update)
    if (mappings.length > 0) {
      const mappingIds = mappings.map((m) => m.id);
      const { error: updateMappingsError } = await supabase
        .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .update({ message_id: postedMessage.id })
        .in("id", mappingIds);

      if (updateMappingsError) {
        console.error("Error updating mappings:", updateMappingsError);
      } else {
        console.log(
          `[Reaction Roles] Updated ${mappingIds.length} mappings with message_id=${postedMessage.id}`,
        );
      }
    }

    let description = `Posted to <#${messageRecord.channel_id}> with ${mappings.length} emoji-role mapping${mappings.length !== 1 ? "s" : ""}`;
    if (failedEmojis.length > 0) {
      description += `\n\n⚠️ Failed to add reactions for: ${failedEmojis.join(", ")}`;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(failedEmojis.length > 0 ? 0xf59e0b : 0x22c55e)
      .setTitle(
        failedEmojis.length > 0
          ? "⚠️ Message Posted (With Warnings)"
          : "✅ Message Posted",
      )
      .setDescription(description);

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back to Settings")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in post message:", errorMsg);
  }
}

/**
 * Cancel message creation
 */
export async function handleCancelCreate(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    // Note: We don't delete pending records as they're automatically excluded from views
    // A background job can periodically clean up abandoned pending messages

    await interaction.deferUpdate();
    await handleShowReactionRolesSettings(interaction, true);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in cancel create:", errorMsg);
  }
}

/**
 * View all reaction role messages
 */
export async function handleViewMessages(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: messages } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("guild_id", guildId)
      .filter("message_id", "not.ilike", "pending_%")
      .order("created_at", { ascending: false });

    if (!messages || messages.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("No Messages")
        .setDescription("No reaction role messages have been posted yet.");

      const backBtn = new ButtonBuilder()
        .setCustomId("reaction_roles_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

      await interaction.editReply({
        embeds: [emptyEmbed],
        components: [row],
      });
      return;
    }

    const messagesEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📋 Reaction Role Messages");

    for (const msg of messages) {
      messagesEmbed.addFields({
        name: msg.title,
        value: `Channel: <#${msg.channel_id}>\nPosted: <t:${Math.floor(new Date(msg.created_at).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    const deleteBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_delete_message")
      .setLabel("Delete Message")
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
      embeds: [messagesEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in view messages:", errorMsg);
  }
}

/**
 * Delete a reaction role message
 */
export async function handleDeleteMessage(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const { data: messages } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("guild_id", guildId)
      .filter("message_id", "not.ilike", "pending_%")
      .order("created_at", { ascending: false });

    if (!messages || messages.length === 0) {
      return;
    }

    const options = messages.slice(0, 25).map((msg) => {
      return new StringSelectMenuOptionBuilder()
        .setLabel(msg.title)
        .setValue(`delete_${msg.id}`)
        .setDescription(`Channel: #${msg.channel_id}`);
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("reaction_roles_delete_select")
      .setPlaceholder("Select message to delete...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_messages")
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
    console.error("Error in delete message:", errorMsg);
  }
}

/**
 * Confirm deletion
 */
export async function handleDeleteSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const selectedValue = interaction.values[0];
    const recordIdStr = selectedValue.replace("delete_", "");
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    // Get message to delete from Discord
    const { data: messageRecord } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("*")
      .eq("id", recordId)
      .single();

    if (messageRecord && messageRecord.message_id !== "pending") {
      try {
        const channel = await interaction.client.channels.fetch(
          messageRecord.channel_id,
        );
        if (channel && channel.isTextBased()) {
          const message = await channel.messages.fetch(
            messageRecord.message_id,
          );
          await message.delete();
        }
      } catch (error) {
        console.error("Failed to delete Discord message:", error);
      }
    }

    // Delete from database (cascades to mappings)
    await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .delete()
      .eq("id", recordId);

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Message Deleted")
      .setDescription("The reaction role message has been removed.");

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_view_messages")
      .setLabel("Back to Messages")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [row],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in delete select:", errorMsg);
  }
}
