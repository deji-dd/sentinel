import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthorizedUser } from "../lib/auth.js";
import {
  validateTornApiKey,
  createTornApiClient,
} from "../services/torn-client.js";
import { encrypt } from "../lib/encryption.js";
import { TABLE_NAMES } from "@sentinel/shared";

export async function handleAccountSettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
) {
  const discordId = interaction.user.id;
  const userId = await getAuthorizedUser(supabase, discordId);

  if (!userId) {
    await interaction.update({
      content:
        "❌ Your account is no longer linked. Please run `/setup` again.",
      embeds: [],
      components: [],
    });
    return;
  }

  // Show API key update modal
  const modal = new ModalBuilder()
    .setCustomId("account_settings_modal")
    .setTitle("Account Settings");

  const apiKeyInput = new TextInputBuilder()
    .setCustomId("api_key")
    .setLabel("New Torn API Key")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Enter your 16-character Torn API key")
    .setMinLength(16)
    .setMaxLength(16)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(apiKeyInput),
  );

  await interaction.showModal(modal);
}

export async function handleAccountSettingsModal(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const discordId = interaction.user.id;
  const userId = await getAuthorizedUser(supabase, discordId);

  if (!userId) {
    await interaction.editReply({
      content:
        "❌ Your account is no longer linked. Please run `/setup` again.",
    });
    return;
  }

  const apiKey = interaction.fields.getTextInputValue("api_key");

  // Validate API key
  const tornApi = createTornApiClient(supabase);

  let validation;
  try {
    validation = await validateTornApiKey(apiKey, tornApi);
  } catch (error) {
    await interaction.editReply({
      content: `❌ Invalid API key: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    return;
  }

  // Encrypt and update API key
  const encryptedKey = encrypt(apiKey);

  const { error } = await supabase
    .from(TABLE_NAMES.USERS)
    .update({ api_key: encryptedKey })
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating API key:", error);
    await interaction.editReply({
      content: "❌ Failed to update API key. Please try again.",
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("✅ API Key Updated")
    .setDescription(
      "Your Torn API key has been successfully updated and encrypted.",
    )
    .addFields(
      {
        name: "Player",
        value: validation.playerName || "Unknown",
        inline: true,
      },
      {
        name: "Player ID",
        value: validation.playerId?.toString() || "Unknown",
        inline: true,
      },
    )
    .setFooter({ text: "Sentinel Settings" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
