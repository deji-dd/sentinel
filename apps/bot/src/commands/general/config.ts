import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { encrypt } from "../../lib/encryption.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure guild settings (admin only)")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("api-key")
      .setDescription("Set the Torn API key for this guild"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("modules")
      .setDescription("Configure enabled modules for this guild"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("nickname-template")
      .setDescription("Set the nickname template for verified users"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Error")
        .setDescription("This command can only be used in a guild.");

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
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

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "api-key") {
      await handleApiKeyConfig(interaction, supabase, guildId);
    } else if (subcommand === "modules") {
      await handleModulesConfig(interaction, supabase, guildId, guildConfig);
    } else if (subcommand === "nickname-template") {
      await handleNicknameTemplateConfig(interaction, supabase, guildId);
    }
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

async function handleApiKeyConfig(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  guildId: string,
): Promise<void> {
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

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(apiKeyInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  // Store guildId in the custom ID context for later retrieval
  // Note: Discord.js doesn't provide direct way to pass context to modal handlers,
  // so we'll handle this in the modal submission handler
}

async function handleModulesConfig(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  guildId: string,
  guildConfig: any,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const availableModules = [
    { name: "Finance", value: "finance" },
    { name: "Search", value: "search" },
  ];

  const moduleOptions = availableModules.map((module) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(module.name)
      .setValue(module.value)
      .setDefault(guildConfig.enabled_modules.includes(module.value)),
  );

  const moduleSelectMenu = new StringSelectMenuBuilder()
    .setCustomId(`config_modules_select|${guildId}`)
    .setPlaceholder("Select modules to enable...")
    .setMinValues(0)
    .setMaxValues(availableModules.length)
    .addOptions(moduleOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    moduleSelectMenu,
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Configure Enabled Modules")
    .setDescription("Select which modules to enable for this guild:")
    .addFields({
      name: "Currently Enabled",
      value:
        guildConfig.enabled_modules.length > 0
          ? guildConfig.enabled_modules.join(", ")
          : "None",
    });

  await interaction.editReply({
    embeds: [embed],
    components: [row],
  });
}

async function handleNicknameTemplateConfig(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
  guildId: string,
): Promise<void> {
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
    .setLabel("Description")
    .setPlaceholder(
      "Use {name} for player name and {id} for Torn player ID (read-only)",
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

    // Remove the encryptionKey check before encrypting
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

// Handler for modules select menu
export async function handleModulesSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const customIdParts = interaction.customId.split("|");
    const guildId = customIdParts[1];
    const selectedModules = interaction.values;

    // Update guild config with selected modules
    const { error } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .update({ enabled_modules: selectedModules })
      .eq("guild_id", guildId);

    if (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ Failed to Update Modules")
        .setDescription(error.message);

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Modules Updated")
      .setDescription("Guild module configuration has been saved.")
      .addFields({
        name: "Enabled Modules",
        value:
          selectedModules.length > 0
            ? selectedModules.join(", ")
            : "None (you can update this later)",
      });

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in modules select handler:", errorMsg);
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
