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
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../../lib/db-client.js";
import { logGuildAction } from "../../../../lib/guild-logger.js";

export type ConfigInteraction =
  | StringSelectMenuInteraction
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ModalSubmitInteraction;

function getConfigSessionUserId(
  footerText?: string,
  defaultUserId?: string,
): string {
  if (!footerText) return defaultUserId || "";
  const match = footerText.match(
    /Config Session:\s*(?:@?[^\s(]+\s*\()?(\d+)\)?/,
  );
  return match ? match[1] : defaultUserId || "";
}

export async function handleShowReactionRolesSettings(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    let enabledModules: string[] = [];
    if (guildConfig?.enabled_modules) {
      try {
        const parsed = JSON.parse(guildConfig.enabled_modules);
        enabledModules = Array.isArray(parsed) ? parsed : [];
      } catch {
        enabledModules = [];
      }
    }

    if (!enabledModules.includes("reaction_roles")) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Reaction Roles Disabled")
        .setDescription(
          "This guild has not enabled the Reaction Roles module yet. Use personal admin module management to enable it first.",
        );

      await interaction.editReply({
        embeds: [disabledEmbed],
        components: [],
      });
      return;
    }

    const message = "message" in interaction ? interaction.message : null;
    const footerText = message?.embeds?.[0]?.footer?.text;
    const originalUserId = getConfigSessionUserId(
      footerText,
      interaction.user.id,
    );

    // Fetch count of reaction roles messages
    const existingMessages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select("id")
      .where("guild_id", "=", guildId)
      .execute();

    const count = existingMessages.length;

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Reaction Roles Settings")
      .setDescription(
        "Create and manage self-assignable reaction role messages.\n\n" +
          `**Active Messages:** \`${count}\` message(s) configured.`,
      )
      .setFooter({
        text: `Sentinel • Config Session: ${originalUserId}`,
      })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId("config_reaction_roles_setting_select")
      .setPlaceholder("Select an action...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Create Reaction Role Message")
          .setValue("create_msg")
          .setDescription("Post a new reaction role embed in a text channel"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Manage Existing Messages")
          .setValue("manage_msgs")
          .setDescription("List details or delete configured reaction role messages"),
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
    console.error("Error showing reaction roles settings:", error);
  }
}

export async function handleReactionRolesSettingSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    const selected = interaction.values[0];
    if (selected === "create_msg") {
      await handleReactionRolesAddMessage(interaction);
    } else if (selected === "manage_msgs") {
      await handleShowManageExistingMessages(interaction);
    }
  } catch (error) {
    console.error("Error in handleReactionRolesSettingSelect:", error);
  }
}

export async function handleReactionRolesAddMessage(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Step 1: Choose Channel")
      .setDescription(
        "Select the text channel where the new reaction role message will be posted.",
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("rr_channel_select_post")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("rr_btn_main_settings")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, rowBtn],
    });
  } catch (error) {
    console.error("Error in handleReactionRolesAddMessage:", error);
  }
}

export async function handleReactionRolesChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    await showRequiredRolesSelectScreen(interaction, channelId);
  } catch (error) {
    console.error("Error in handleReactionRolesChannelSelect:", error);
  }
}

async function showRequiredRolesSelectScreen(
  interaction: ConfigInteraction,
  channelId: string,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Step 2: Required Roles (Optional)")
    .setDescription(
      `Target Channel: <#${channelId}>\n\n` +
        "Select the roles a user **must have** to react and toggle roles.\n\n" +
        "If you want **anyone** to be allowed to react, click the **Skip / No Required Roles** button below.",
    );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`rr_roles_select_required|${channelId}`)
    .setPlaceholder("Select required roles...")
    .setMinValues(1)
    .setMaxValues(5);

  const skipBtn = new ButtonBuilder()
    .setCustomId(`rr_btn_skip_req_roles|${channelId}`)
    .setLabel("Skip / No Required Roles")
    .setStyle(ButtonStyle.Primary);

  const backBtn = new ButtonBuilder()
    .setCustomId("rr_btn_add_message")
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const rowSelect =
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
  const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
    skipBtn,
    backBtn,
  );

  await interaction.editReply({
    embeds: [embed],
    components: [rowSelect, rowBtn],
  });
}

export async function handleReactionRolesRequiredRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    if (!channelId) return;

    const selectedRoleIds = interaction.values;
    await showSelectMappedRolesScreen(
      interaction,
      channelId,
      selectedRoleIds.join(","),
    );
  } catch (error) {
    console.error("Error in handleReactionRolesRequiredRolesSelect:", error);
  }
}

export async function handleReactionRolesSkipRequiredRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    if (!channelId) return;

    await showSelectMappedRolesScreen(interaction, channelId, "none");
  } catch (error) {
    console.error("Error in handleReactionRolesSkipRequiredRoles:", error);
  }
}

export async function handleReactionRolesBackToRequiredRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    if (!channelId) return;

    await showRequiredRolesSelectScreen(interaction, channelId);
  } catch (error) {
    console.error("Error in handleReactionRolesBackToRequiredRoles:", error);
  }
}

export async function handleReactionRolesBackToMappedRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    const requiredRoleIds = parts[2];
    if (!channelId || !requiredRoleIds) return;

    await showSelectMappedRolesScreen(interaction, channelId, requiredRoleIds);
  } catch (error) {
    console.error("Error in handleReactionRolesBackToMappedRoles:", error);
  }
}

async function showSelectMappedRolesScreen(
  interaction: ConfigInteraction,
  channelId: string,
  requiredRoleIds: string,
): Promise<void> {
  // Ensure guild cache is warmed up
  await interaction.guild?.roles.fetch().catch(() => null);

  let reqRolesText = "None (Anyone can react)";
  if (requiredRoleIds !== "none") {
    reqRolesText = requiredRoleIds
      .split(",")
      .map((id) => `<@&${id}>`)
      .join(", ");
  }

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Step 3: Select Mapped Roles")
    .setDescription(
      `**Target Channel:** <#${channelId}>\n` +
        `**Required Role(s):** ${reqRolesText}\n\n` +
        "Choose between **1 and 5 roles** from the select menu below that users can self-assign via reactions.",
    );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`rr_roles_select_mappings|${channelId}|${requiredRoleIds}`)
    .setPlaceholder("Select 1-5 roles to map...")
    .setMinValues(1)
    .setMaxValues(5);

  const backBtn = new ButtonBuilder()
    .setCustomId(`rr_btn_back_to_req_roles|${channelId}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary);

  const rowSelect =
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);
  const rowBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

  await interaction.editReply({
    embeds: [embed],
    components: [rowSelect, rowBtn],
  });
}

export async function handleReactionRolesRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    const requiredRoleIds = parts[2];
    if (!channelId || !requiredRoleIds) return;

    const selectedRoleIds = interaction.values;
    if (selectedRoleIds.length === 0) return;

    const roleMentions = selectedRoleIds.map((id) => `<@&${id}>`).join("\n");
    let reqRolesText = "None (Anyone can react)";
    if (requiredRoleIds !== "none") {
      reqRolesText = requiredRoleIds
        .split(",")
        .map((id) => `<@&${id}>`)
        .join(", ");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Step 4: Confirm Setup")
      .setDescription(
        `**Channel:** <#${channelId}>\n` +
          `**Required Role(s):** ${reqRolesText}\n\n` +
          `**Mapped Roles (in order):**\n${roleMentions}\n\n` +
          "Click the button below to configure the message details and assign emojis.",
      );

    const fillDetailsBtn = new ButtonBuilder()
      .setCustomId(
        `rr_btn_fill_details|${channelId}|${requiredRoleIds}|${selectedRoleIds.join(",")}`,
      )
      .setLabel("Configure Emojis & Message")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId(`rr_btn_back_to_mapped_roles|${channelId}|${requiredRoleIds}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      fillDetailsBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleReactionRolesRolesSelect:", error);
  }
}

export async function handleReactionRolesFillDetails(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    const requiredRoleIds = parts[2];
    const roleIds = parts[3];
    if (!channelId || !requiredRoleIds || !roleIds) return;

    const selectedCount = roleIds.split(",").length;

    const modal = new ModalBuilder()
      .setCustomId(`rr_modal_create_message|${channelId}|${requiredRoleIds}|${roleIds}`)
      .setTitle("Create Reaction Role Message");

    const titleInput = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Message Title")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g., Get Roles Here")
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Description (Optional)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("React to toggle roles:")
      .setRequired(false);

    const emojisInput = new TextInputBuilder()
      .setCustomId("emojis")
      .setLabel(`Emojis (one per line, exactly ${selectedCount})`)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("e.g.\n👍\n❤️\n🔥")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(emojisInput),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error opening details modal:", error);
  }
}

export async function handleReactionRolesModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const guild = interaction.guild;
    if (!guildId || !guild) return;

    const customId = interaction.customId;
    const parts = customId.split("|");
    const channelId = parts[1];
    const requiredRoleIds = parts[2];
    const roleIdsStr = parts[3];
    if (!channelId || !requiredRoleIds || !roleIdsStr) return;

    const roleIds = roleIdsStr.split(",");

    const title = interaction.fields.getTextInputValue("title").trim();
    const description = interaction.fields.getTextInputValue("description").trim();
    const emojisInput = interaction.fields.getTextInputValue("emojis").trim();

    // Parse and validate emojis
    const emojis = emojisInput
      .split("\n")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (emojis.length !== roleIds.length) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Emoji Count")
        .setDescription(
          `You selected **${roleIds.length}** role(s), but provided **${emojis.length}** emoji(s). ` +
            `Please make sure to input exactly one emoji per line.`,
        );

      const tryAgainBtn = new ButtonBuilder()
        .setCustomId(`rr_btn_fill_details|${channelId}|${requiredRoleIds}|${roleIdsStr}`)
        .setLabel("Try Again")
        .setStyle(ButtonStyle.Primary);

      const backBtn = new ButtonBuilder()
        .setCustomId("rr_btn_main_settings")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        tryAgainBtn,
        backBtn,
      );

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [row],
      });
      return;
    }

    // Validate channel
    const channel = await interaction.client.channels
      .fetch(channelId)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Invalid Channel")
        .setDescription("The selected text channel is no longer accessible.");

      const backBtn = new ButtonBuilder()
        .setCustomId("rr_btn_main_settings")
        .setLabel("Back to Settings")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);
      await interaction.editReply({ embeds: [errorEmbed], components: [row] });
      return;
    }

    // Build the posted message embed content
    let finalDescription =
      description || "React with the emojis below to assign yourself roles:";
    finalDescription += "\n\n";
    for (let i = 0; i < roleIds.length; i++) {
      finalDescription += `${emojis[i]} → <@&${roleIds[i]}>\n`;
    }

    if (requiredRoleIds !== "none") {
      const roleMentions = requiredRoleIds
        .split(",")
        .map((id) => `<@&${id}>`)
        .join(", ");
      finalDescription += `\n*Note: You must have the following role(s) to react: ${roleMentions}*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(title)
      .setDescription(finalDescription);

    const postedMessage = await (channel as any).send({ embeds: [embed] });

    // React to the message
    for (const emoji of emojis) {
      try {
        await postedMessage.react(emoji);
      } catch (e) {
        console.warn(`Failed to react with ${emoji} on message ${postedMessage.id}:`, e);
      }
    }

    // Save to Database
    const dbRequiredRoleIds =
      requiredRoleIds !== "none" ? requiredRoleIds : null;

    await db
      .insertInto(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .values({
        guild_id: guildId,
        channel_id: channelId,
        message_id: postedMessage.id,
        title: title,
        description: description || null,
        required_role_id: dbRequiredRoleIds,
        sync_roles: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    for (let i = 0; i < roleIds.length; i++) {
      await db
        .insertInto(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
        .values({
          id: Date.now() * 1000 + i + Math.floor(Math.random() * 1000),
          message_id: postedMessage.id,
          emoji: emojis[i],
          role_id: roleIds[i],
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    await logGuildAction(guildId, interaction.client, {
      title: "Reaction Role Message Created",
      description: `<@${interaction.user.id}> created a new reaction role message in <#${channelId}>.`,
    });

    // Success feedback
    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Reaction Role Message Created!")
      .setDescription(
        `Successfully posted message to <#${channelId}> with ${roleIds.length} role mapping(s).`,
      );

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    // Hold visual success message briefly, then redirect back to dashboard
    setTimeout(async () => {
      await handleShowReactionRolesSettings(interaction, true).catch(() => null);
    }, 2500);
  } catch (error) {
    console.error("Error creating reaction role message:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Error")
      .setDescription("Failed to create the reaction role message.");
    await interaction.editReply({ embeds: [errorEmbed], components: [] });
  }
}

export async function handleShowManageExistingMessages(
  interaction: ConfigInteraction,
  isAlreadyDeferred = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred && "deferUpdate" in interaction) {
      await (interaction as any).deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("guild_id", "=", guildId)
      .execute();

    if (messages.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("No Messages Found")
        .setDescription(
          "There are no active reaction role messages registered for this guild.",
        );

      const backBtn = new ButtonBuilder()
        .setCustomId("rr_btn_main_settings")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Manage Reaction Role Messages")
      .setDescription("Select a message from the dropdown below to view details or delete it.");

    const select = new StringSelectMenuBuilder()
      .setCustomId("rr_select_manage_msg")
      .setPlaceholder("Select a message...");

    for (const msg of messages) {
      const label = msg.title.substring(0, 100) || "Reaction Role Message";
      select.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(String(msg.id))
          .setDescription(`Channel: #${msg.channel_id.substring(0, 10)}...`),
      );
    }

    const backBtn = new ButtonBuilder()
      .setCustomId("rr_btn_main_settings")
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
    console.error("Error showing manage messages page:", error);
  }
}

export async function handleReactionRolesSelectMessage(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const msgId = parseInt(interaction.values[0], 10);
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", msgId)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!messageRecord) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Message Not Found")
        .setDescription("Could not find the reaction role message in the database.");
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
      return;
    }

    const mappings = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .selectAll()
      .where("message_id", "=", messageRecord.message_id)
      .execute();

    let detailsText = `**Channel:** <#${messageRecord.channel_id}>\n`;
    detailsText += `**Message ID:** \`${messageRecord.message_id}\`\n`;
    if (messageRecord.required_role_id) {
      const roleMentions = messageRecord.required_role_id
        .split(",")
        .map((rid) => `<@&${rid}>`)
        .join(", ");
      detailsText += `**Required Role(s):** ${roleMentions}\n`;
    } else {
      detailsText += `**Required Role(s):** None\n`;
    }

    detailsText += `\n**Mappings:**\n`;
    if (mappings.length > 0) {
      detailsText += mappings.map((m) => `${m.emoji} → <@&${m.role_id}>`).join("\n");
    } else {
      detailsText += `*None configured*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`Reaction Role: ${messageRecord.title}`)
      .setDescription(detailsText);

    const deleteBtn = new ButtonBuilder()
      .setCustomId(`rr_btn_delete_msg|${messageRecord.id}`)
      .setLabel("Delete Message")
      .setStyle(ButtonStyle.Danger);

    const backBtn = new ButtonBuilder()
      .setCustomId("rr_btn_manage_messages")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      deleteBtn,
      backBtn,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error selecting reaction role message:", error);
  }
}

export async function handleReactionRoleDeleteMsgBtn(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const msgId = parseInt(interaction.customId.split("|")[1], 10);
    const messageRecord = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .selectAll()
      .where("id", "=", msgId)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!messageRecord) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Message Not Found")
        .setDescription("Could not find the reaction role message to delete.");
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
      return;
    }

    // Try deleting Discord message
    try {
      const channel = await interaction.client.channels.fetch(messageRecord.channel_id);
      if (channel && channel.isTextBased()) {
        const discordMsg = await (channel as any).messages.fetch(messageRecord.message_id);
        if (discordMsg) {
          await discordMsg.delete();
        }
      }
    } catch (e) {
      console.warn("Could not delete the Discord message directly (it might be already deleted):", e);
    }

    // Delete mappings & message from DB
    await db
      .deleteFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .where("id", "=", msgId)
      .execute();

    await db
      .deleteFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .where("message_id", "=", messageRecord.message_id)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Reaction Role Message Deleted",
      description: `<@${interaction.user.id}> deleted a reaction role message (ID: \`${messageRecord.message_id}\`).`,
      color: 0xef4444,
    });

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Deleted Reaction Role Message")
      .setDescription("The Discord message and database records have been deleted.");

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    setTimeout(async () => {
      await handleShowReactionRolesSettings(interaction, true).catch(() => null);
    }, 2500);
  } catch (error) {
    console.error("Error deleting reaction role message:", error);
  }
}
