import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { encrypt } from "../../lib/encryption.js";

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
          "Please run `/setup-guild` first to initialize this guild.",
        );

      await interaction.editReply({
        embeds: [errorEmbed],
      });
      return;
    }

    // Show current config with edit buttons
    const configEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Guild Configuration")
      .setDescription("Current settings for this guild:")
      .addFields(
        {
          name: "API Key",
          value: guildConfig.api_key
            ? "✅ Configured"
            : "❌ Not configured",
          inline: true,
        },
        {
          name: "Nickname Template",
          value: guildConfig.nickname_template || "{name}#{id}",
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
      )
      .setFooter({
        text: "Use the buttons below to modify settings",
      });

    const editApiKeyBtn = new ButtonBuilder()
      .setCustomId("config_edit_api_key")
      .setLabel("Set API Key")
      .setStyle(ButtonStyle.Primary);

    const editNicknameBtn = new ButtonBuilder()
      .setCustomId("config_edit_nickname")
      .setLabel("Edit Nickname Template")
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      editApiKeyBtn,
      editNicknameBtn,
    );

    await interaction.editReply({
      embeds: [configEmbed],
      components: [buttonRow],
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
      .setPlaceholder("e.g., {name}#{id}")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue("{name}#{id}");

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description_input")
      .setLabel("Description (optional)")
      .setPlaceholder(
        "Use {name} for player name and {id} for Torn player ID",
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

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
