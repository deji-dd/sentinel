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
import { db, finalizeReactionRoleMessage } from "../../../../lib/db-client.js";

async function buildRoleMappingDescription(
  messageId: string,
  baseDescription: string | null,
): Promise<string> {
  const mappings = await db
    .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
    .select(["emoji", "role_id"])
    .where("message_id", "=", messageId)
    .orderBy("created_at", "asc")
    .execute();

  let finalDescription =
    baseDescription || "React with the emojis below to assign yourself roles:";

  if (mappings && mappings.length > 0) {
    finalDescription += "\n\n";
    for (const mapping of mappings) {
      finalDescription += `${mapping.emoji} → <@&${mapping.role_id}>\n`;
    }
  }

  return finalDescription;
}

async function syncPostedReactionRoleMessage(
  client: ButtonInteraction["client"],
  messageRecord: {
    message_id: string;
    channel_id: string;
    title: string;
    description: string | null;
  },
): Promise<void> {
  if (messageRecord.message_id.startsWith("pending_")) {
    return;
  }

  const channel = await client.channels.fetch(messageRecord.channel_id);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return;
  }

  const message = await channel.messages.fetch(messageRecord.message_id);
  const finalDescription = await buildRoleMappingDescription(
    messageRecord.message_id,
    messageRecord.description,
  );

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(messageRecord.title)
    .setDescription(finalDescription);

  await message.edit({ embeds: [embed] });
}

function createMappingId(): number {
  // Keep mapping ids numeric because they are encoded/decoded via parseInt in custom IDs.
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

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
    const config = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    // Fetch existing reaction role messages (only posted ones, exclude pending)
    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("message_id", "not like", "pending_%")
      .orderBy("created_at", "desc")
      .execute();

    console.log(
      `[Reaction Roles] Found ${messages?.length || 0} posted messages for guild ${guildId}`,
    );

    const allowedRoleIds = config?.allowed_role_ids
      ? JSON.parse(config.allowed_role_ids)
      : [];
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
    await db
      .insertInto(TABLE_NAMES.REACTION_ROLE_CONFIG)
      .values({
        guild_id: guildId,
        allowed_role_ids: JSON.stringify(selectedRoles),
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column("guild_id").doUpdateSet({
          allowed_role_ids: JSON.stringify(selectedRoles),
          updated_at: new Date().toISOString(),
        }),
      )
      .execute();

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

    const messageRecord = await db
      .insertInto(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .values({
        guild_id: guildId,
        channel_id: selectedChannelId,
        message_id: tempMessageId,
        title: "Loading...",
        description: null,
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (!messageRecord) {
      console.error("Error creating message record");
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

    const title =
      interaction.fields.getTextInputValue("embed_title").trim() ||
      "Select Your Roles";
    const description =
      interaction.fields.getTextInputValue("embed_description").trim() || null;

    // Update the message record with details
    await db
      .updateTable(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .set({ title, description })
      .where("id", "=", recordId)
      .execute();

    // Show UI for adding mappings
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Add Emoji-Role Pairs")
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
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const recordIdStr = customIdParts[1];
    const mode = customIdParts[2] === "edit" ? "edit" : "create";
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const emoji = interaction.fields.getTextInputValue("emoji_input").trim();

    // Validate emoji
    if (!isValidEmoji(emoji)) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Emoji")
        .setDescription(
          "Please enter a valid emoji (e.g., 🎮, 👍)\n\nCustom emojis and invalid characters are not supported.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Get the message record to ensure it exists
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

    if (!messageRecord) {
      return;
    }

    // Show role selector with emoji context
    const instructionEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Select Role")
      .setDescription(`Choose which role the ${emoji} emoji should assign:`);

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(
        `reaction_role_mapping_role_select|${recordId}|${emoji}|${mode}`,
      )
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
    const isEditMode = customIdParts[customIdParts.length - 1] === "edit";
    const emojiParts = isEditMode
      ? customIdParts.slice(2, -1)
      : customIdParts.slice(2);
    const emoji = emojiParts.join("|");
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const selectedRoleId = interaction.values[0];

    // Get the message record
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

    if (!messageRecord) {
      return;
    }

    // Use the actual message_id from the record (already unique)
    const currentMessageId = messageRecord.message_id;

    // Upsert mapping so existing emoji mappings can be edited
    await db
      .insertInto(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .values({
        id: createMappingId(),
        message_id: currentMessageId,
        emoji,
        role_id: selectedRoleId,
        created_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(["message_id", "emoji"]).doUpdateSet({
          role_id: selectedRoleId,
        }),
      )
      .execute();

    if (isEditMode && !currentMessageId.startsWith("pending_")) {
      try {
        const channel = await interaction.client.channels.fetch(
          messageRecord.channel_id,
        );
        if (channel && channel.isTextBased() && !channel.isDMBased()) {
          const postedMessage = await channel.messages.fetch(currentMessageId);
          await postedMessage.react(emoji).catch((reactionError) => {
            console.warn(
              "Failed adding reaction while editing mapping:",
              reactionError,
            );
          });
        }

        await syncPostedReactionRoleMessage(interaction.client, messageRecord);
      } catch (reactionSyncError) {
        console.warn(
          "Could not sync reaction on existing message:",
          reactionSyncError,
        );
      }
    }

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(isEditMode ? "Mapping Saved" : "✅ Mapping Added")
      .setDescription(`${emoji} → <@&${selectedRoleId}>`);

    if (isEditMode) {
      const addAnotherBtn = new ButtonBuilder()
        .setCustomId(`reaction_role_edit_add_mapping|${recordId}`)
        .setLabel("Add/Update Mapping")
        .setStyle(ButtonStyle.Primary);

      const removeBtn = new ButtonBuilder()
        .setCustomId(`reaction_role_edit_remove_mapping|${recordId}`)
        .setLabel("Remove Mapping")
        .setStyle(ButtonStyle.Danger);

      const backBtn = new ButtonBuilder()
        .setCustomId("reaction_roles_view_messages")
        .setLabel("Back to Messages")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        addAnotherBtn,
        removeBtn,
        backBtn,
      );

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
      });
      return;
    }

    const continueBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_add_mapping|${recordId}`)
      .setLabel("Add Another")
      .setStyle(ButtonStyle.Primary);

    const postBtn = new ButtonBuilder()
      .setCustomId(`reaction_role_post_message|${recordId}`)
      .setLabel("Post Message")
      .setStyle(ButtonStyle.Success);

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_cancel_create")
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
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

    if (!messageRecord) {
      console.error(
        `[Reaction Roles] Message record not found for id: ${recordId}`,
      );
      return;
    }

    console.log(`[Reaction Roles] Found message record:`, messageRecord);

    // Get mappings for this message
    const mappings = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .selectAll()
      .where("message_id", "=", messageRecord.message_id)
      .orderBy("created_at", "asc")
      .execute();
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
    let finalDescription =
      messageRecord.description ||
      "React with the emojis below to assign yourself roles:";

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

    // Atomically finalize pending_* message_id -> real Discord message ID
    let finalizeData;
    let finalizeError;
    try {
      finalizeData = await finalizeReactionRoleMessage(
        recordId,
        postedMessage.id,
      );
    } catch (error) {
      finalizeError = error;
    }

    if (finalizeError) {
      console.error(
        "Error finalizing reaction role message and mappings:",
        finalizeError,
      );

      // Roll back the posted Discord message to avoid orphaned reaction-role posts
      try {
        await postedMessage.delete();
      } catch (deleteError) {
        console.error(
          "Failed to delete posted message after finalize error:",
          deleteError,
        );
      }

      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Failed to Save Reaction Role Message")
        .setDescription(
          "The message was posted but could not be saved to the database, so it was deleted automatically. Please try posting again.",
        );

      const backBtn = new ButtonBuilder()
        .setCustomId("reaction_roles_settings_show")
        .setLabel("Back to Settings")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [row],
      });
      return;
    } else {
      const result = Array.isArray(finalizeData)
        ? finalizeData[0]
        : finalizeData;
      console.log(
        `[Reaction Roles] Finalized recordId=${recordId}, messageRows=${result?.updated_message_rows ?? 0}, mappingRows=${result?.updated_mapping_rows ?? 0}, discordMessageId=${postedMessage.id}`,
      );
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

async function showEditMappingsForMessage(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  recordId: number,
): Promise<void> {
  const messageRecord = await db
    .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
    .selectAll()
    .where("id", "=", recordId)
    .executeTakeFirst();

  if (!messageRecord) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Message Not Found")
      .setDescription("Could not load the selected reaction role message.");

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
    });
    return;
  }

  const mappings = await db
    .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
    .selectAll()
    .where("message_id", "=", messageRecord.message_id)
    .orderBy("created_at", "asc")
    .execute();

  const mappingLines =
    mappings && mappings.length > 0
      ? mappings
          .map((mapping) => `${mapping.emoji} → <@&${mapping.role_id}>`)
          .join("\n")
      : "No mappings configured yet.";

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Edit Emoji-Role Mappings")
    .setDescription(
      `Message: ${messageRecord.title}\nChannel: <#${messageRecord.channel_id}>`,
    )
    .addFields({
      name: "Current Mappings",
      value: mappingLines,
      inline: false,
    });

  const addBtn = new ButtonBuilder()
    .setCustomId(`reaction_role_edit_add_mapping|${recordId}`)
    .setLabel("Add/Update Mapping")
    .setStyle(ButtonStyle.Primary);

  const removeBtn = new ButtonBuilder()
    .setCustomId(`reaction_role_edit_remove_mapping|${recordId}`)
    .setLabel("Remove Mapping")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!mappings || mappings.length === 0);

  const backBtn = new ButtonBuilder()
    .setCustomId("reaction_roles_view_messages")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    addBtn,
    removeBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [embed],
    components: [row],
  });
}

export async function handleEditMappings(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("message_id", "not like", "pending_%")
      .orderBy("created_at", "desc")
      .execute();

    if (!messages || messages.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("No Messages")
        .setDescription("No reaction role messages have been posted yet.");

      const backBtn = new ButtonBuilder()
        .setCustomId("reaction_roles_view_messages")
        .setLabel("Back")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

      await interaction.editReply({ embeds: [emptyEmbed], components: [row] });
      return;
    }

    const options = messages.slice(0, 25).map((msg) => {
      return new StringSelectMenuOptionBuilder()
        .setLabel(msg.title)
        .setValue(`edit_${msg.id}`)
        .setDescription(`Channel: #${msg.channel_id}`);
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("reaction_roles_edit_select")
      .setPlaceholder("Select message to edit mappings...")
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
    console.error("Error in edit mappings:", errorMsg);
  }
}

export async function handleEditMappingsSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const selectedValue = interaction.values[0];
    const recordIdStr = selectedValue.replace("edit_", "");
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    await showEditMappingsForMessage(interaction, recordId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit mappings select:", errorMsg);
  }
}

export async function handleEditAddMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const recordIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(recordIdStr, 10);

    if (isNaN(recordId)) {
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`reaction_role_mapping_emoji_modal|${recordId}|edit`)
      .setTitle("Add Emoji-Role Mapping");

    const emojiInput = new TextInputBuilder()
      .setCustomId("emoji_input")
      .setLabel("Emoji")
      .setPlaceholder("e.g., 🎮 or 👍")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      emojiInput,
    );

    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit add mapping:", errorMsg);
  }
}

export async function handleEditRemoveMapping(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const recordIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(recordIdStr, 10);
    if (isNaN(recordId)) return;

    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

    if (!messageRecord) return;

    const mappings = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .selectAll()
      .where("message_id", "=", messageRecord.message_id)
      .orderBy("created_at", "asc")
      .execute();

    if (!mappings || mappings.length === 0) {
      await showEditMappingsForMessage(interaction, recordId);
      return;
    }

    const options = mappings.slice(0, 25).map((mapping) => {
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${mapping.emoji} → ${mapping.role_id}`)
        .setValue(`remove_${mapping.id}`)
        .setDescription(`Role: ${mapping.role_id}`);
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`reaction_role_edit_remove_select|${recordId}`)
      .setPlaceholder("Select mapping to remove...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu,
    );

    const backBtn = new ButtonBuilder()
      .setCustomId(`reaction_roles_edit_select_return|${recordId}`)
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
    console.error("Error in edit remove mapping:", errorMsg);
  }
}

export async function handleEditRemoveMappingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const recordIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(recordIdStr, 10);
    if (isNaN(recordId)) return;

    const selectedValue = interaction.values[0];
    const mappingIdStr = selectedValue.replace("remove_", "");
    const mappingId = parseInt(mappingIdStr, 10);

    if (isNaN(mappingId)) {
      return;
    }

    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

    const mappingRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .selectAll()
      .where("id", "=", mappingId)
      .executeTakeFirst();

    await db
      .deleteFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .where("id", "=", mappingId)
      .execute();

    if (
      messageRecord &&
      mappingRecord &&
      !messageRecord.message_id.startsWith("pending_")
    ) {
      try {
        const channel = await interaction.client.channels.fetch(
          messageRecord.channel_id,
        );
        if (channel && channel.isTextBased() && !channel.isDMBased()) {
          const postedMessage = await channel.messages.fetch(
            messageRecord.message_id,
          );
          const reaction = postedMessage.reactions.cache.find(
            (item) => item.emoji.toString() === mappingRecord.emoji,
          );
          if (reaction) {
            await reaction.remove();
          }
        }

        await syncPostedReactionRoleMessage(interaction.client, messageRecord);
      } catch (reactionSyncError) {
        console.warn(
          "Could not remove reaction from existing message:",
          reactionSyncError,
        );
      }
    }

    await showEditMappingsForMessage(interaction, recordId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit remove mapping select:", errorMsg);
  }
}

export async function handleEditMappingsReturn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const recordIdStr = interaction.customId.split("|")[1];
    const recordId = parseInt(recordIdStr, 10);
    if (isNaN(recordId)) return;

    await showEditMappingsForMessage(interaction, recordId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in edit mappings return:", errorMsg);
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

    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("message_id", "not like", "pending_%")
      .orderBy("created_at", "desc")
      .execute();

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
      .setTitle("Reaction Role Messages");

    for (const msg of messages) {
      messagesEmbed.addFields({
        name: msg.title,
        value: `Channel: <#${msg.channel_id}>\nPosted: <t:${Math.floor(new Date(msg.created_at).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    const editBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_edit_mappings")
      .setLabel("Edit Mappings")
      .setStyle(ButtonStyle.Primary);

    const deleteBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_delete_message")
      .setLabel("Delete Message")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("reaction_roles_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editBtn,
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

    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("message_id", "not like", "pending_%")
      .orderBy("created_at", "desc")
      .execute();

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
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", recordId)
      .executeTakeFirst();

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
    await db
      .deleteFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .where("id", "=", recordId)
      .execute();

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
