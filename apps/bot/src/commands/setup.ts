import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userExists } from "../lib/auth.js";
import { validateTornApiKey } from "../services/torn.js";
import { encrypt } from "../lib/encryption.js";
import { TABLE_NAMES } from "../lib/constants.js";

export const data = {
  name: "setup",
  description: "Link your Torn City account to Sentinel",
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
) {
  const discordId = interaction.user.id;

  // Check if user already has an account
  const exists = await userExists(supabase, discordId);
  if (exists) {
    await interaction.reply({
      content:
        "❌ You already have an account linked to Sentinel. If you need to update your API key, please contact support.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Create modal for API key input
  const modal = new ModalBuilder()
    .setCustomId("setup-modal")
    .setTitle("Account Linking");

  const apiKeyInput = new TextInputBuilder()
    .setCustomId("api-key")
    .setLabel("Enter your Torn API Key (16 characters)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Encrypted with AES-256-GCM • Requires Level 3+")
    .setRequired(true)
    .setMinLength(16)
    .setMaxLength(16);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
    apiKeyInput,
  );

  modal.addComponents(row);

  await interaction.showModal(modal);
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const discordId = interaction.user.id;

  // Defer reply immediately to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Double-check user doesn't already exist
    const exists = await userExists(supabase, discordId);
    if (exists) {
      await interaction.editReply(
        "❌ You already have an account linked to Sentinel.",
      );
      return;
    }

    const apiKey = interaction.fields.getTextInputValue("api-key").trim();

    // Validate API key with Torn API
    const { playerId, playerName, isDonator, accessLevel } =
      await validateTornApiKey(apiKey);

    const email = `${playerId}@sentinel.com`;
    const randomPassword = crypto.randomUUID();

    // Check if Supabase auth user already exists
    const { data: listData, error: listError } =
      await supabase.auth.admin.listUsers();

    if (listError) {
      throw new Error(`Failed to fetch users: ${listError.message}`);
    }

    const existingUser = listData?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existingUser) {
      throw new Error(
        `This Torn account is already linked to another Discord user. Each Torn account can only be linked once.`,
      );
    }

    // Create new Supabase auth user
    const { data: newUser, error: signupError } =
      await supabase.auth.admin.createUser({
        email,
        password: randomPassword,
        email_confirm: true,
      });

    if (signupError || !newUser.user) {
      throw new Error(
        `Failed to create user: ${signupError?.message || "Unknown error"}`,
      );
    }

    const userId = newUser.user.id;

    // Rollback mechanism - track what needs cleanup on error
    let needsAuthCleanup = true;
    let needsUserTableCleanup = false;

    try {
      // Encrypt and store API key
      const encryptedKey = encrypt(apiKey);

      const { error: upsertKeyError } = await supabase
        .from(TABLE_NAMES.USERS)
        .upsert(
          {
            user_id: userId,
            api_key: encryptedKey,
          },
          { onConflict: "user_id" },
        );

      if (upsertKeyError) {
        throw new Error(`Failed to store API key: ${upsertKeyError.message}`);
      }

      needsUserTableCleanup = true;

      // Store user data with Discord ID
      const { error: upsertDataError } = await supabase
        .from(TABLE_NAMES.USER_DATA)
        .upsert(
          {
            user_id: userId,
            player_id: playerId,
            name: playerName,
            is_donator: isDonator,
            discord_id: discordId,
          },
          { onConflict: "user_id" },
        );

      if (upsertDataError) {
        throw new Error(
          `Failed to store user data: ${upsertDataError.message}`,
        );
      }

      // Success - no cleanup needed
      needsAuthCleanup = false;

      await interaction.editReply(
        `✅ **Account linked successfully!**\n\n` +
          `👤 **Player:** ${playerName} [${playerId}]\n` +
          `🔑 **Access Level:** ${accessLevel === 3 ? "Limited" : "Full"}\n` +
          `Your API key has been securely encrypted and stored. You can now use Sentinel commands!\n\n` +
          `⚠️ **Security Notice:**\n` +
          `• Your API key is encrypted using AES-256-GCM\n` +
          `• Never share your API key with anyone\n` +
          `• If your key is compromised, regenerate it in Torn and contact support`,
      );
    } catch (setupError) {
      // Rollback: Clean up any partial data
      console.error("[Setup] Error during setup, rolling back:", setupError);

      if (needsUserTableCleanup) {
        await supabase
          .from(TABLE_NAMES.USER_DATA)
          .delete()
          .eq("user_id", userId);
        await supabase.from(TABLE_NAMES.USERS).delete().eq("user_id", userId);
      }

      if (needsAuthCleanup) {
        await supabase.auth.admin.deleteUser(userId);
      }

      throw setupError;
    }
  } catch (error) {
    console.error("[Setup] Error during modal submit:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await interaction.editReply(
      `❌ **Setup failed:** ${errorMessage}\n\n` +
        `Please ensure:\n` +
        `• Your API key is exactly 16 alphanumeric characters\n` +
        `• You have Limited Access (level 3) or Full Access (level 4)\n` +
        `• Your API key hasn't been paused or disabled`,
    );
  }
}
