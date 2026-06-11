/**
 * Mercenary Module Button Handlers
 * Handles dibs claims and releases
 */

import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { logGuildError, logGuildSuccess } from "./guild-logger.js";
import { randomUUID } from "crypto";

/**
 * Handle mercenary claim target button
 * Shows a select menu for available targets
 */
export async function handleMercClaimButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const contractId = interaction.customId.split("_").pop();
  if (!contractId) {
    await interaction.reply({
      content: "Invalid contract ID",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    // Check if user is registered
    const registration = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", interaction.user.id)
      .where("is_active", "=", 1)
      .executeTakeFirst();

    if (!registration) {
      await interaction.reply({
        content: "❌ You must register as a merc first. Use `/merc register`",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get dibs config
    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!dibsConfig) {
      await interaction.reply({
        content: "❌ Dibs system not configured",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check active dibs count
    const activeDibs = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
      .selectAll()
      .where("merc_discord_id", "=", interaction.user.id)
      .where("status", "=", "active")
      .execute();

    if (activeDibs.length >= dibsConfig.max_active_dibs_per_person) {
      await interaction.reply({
        content: `❌ You already have ${activeDibs.length} active dib${activeDibs.length !== 1 ? "s" : ""} (max: ${dibsConfig.max_active_dibs_per_person})`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get contract and extract targets from message
    const contract = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("id", "=", contractId)
      .executeTakeFirst();

    if (!contract) {
      await interaction.reply({
        content: "❌ Contract not found",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Parse available targets from the message
    // This is a simplified approach - in production, you'd want to store this data
    const message = await interaction.message.fetch();
    const embed = message.embeds[0];

    if (!embed || !embed.fields) {
      await interaction.reply({
        content: "❌ Could not find targets in message",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Extract targets from embed (format: "• **name** [L##] - ##m left")
    const targetField = embed.fields.find(
      (f) =>
        f.name === "Targets (with remaining hospital time)" ||
        f.name === "Available Targets",
    );

    if (!targetField) {
      await interaction.reply({
        content: "❌ No targets available",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Parse targets
    const targetLines = targetField.value.split("\n");
    const targets = targetLines
      .filter((line) => line.startsWith("•"))
      .slice(0, 25) // Max 25 options for select menu
      .map((line) => {
        const match = line.match(/\*\*([^*]+)\*\*/);
        const name = match ? match[1] : line;
        return {
          label: name.substring(0, 100), // Discord limit
          value: `${contractId}|${name}`, // Store contract + name
        };
      });

    if (targets.length === 0) {
      await interaction.reply({
        content: "❌ No targets available",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`merc_select_target|${registration.id}`)
        .setPlaceholder("Select a target to claim")
        .addOptions(targets.map((t) => new StringSelectMenuOptionBuilder(t))),
    );

    await interaction.reply({
      content: "Select a target to claim:",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await logGuildError(
      guildId,
      interaction.client,
      "Mercenary Dibs Error",
      error instanceof Error ? error : String(error),
      "Failed to show claim menu",
    );
    await interaction.reply({
      content: "❌ An error occurred",
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle target selection from the claim menu
 */
export async function handleMercSelectTarget(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const selected = interaction.values[0];
  if (!selected) return;

  const [contractId, targetName] = selected.split("|");
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    // Create dibs claim
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30); // Dibs last 30 min

    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!dibsConfig) {
      await interaction.reply({
        content: "❌ Dibs system not configured",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    expiresAt.setMinutes(
      expiresAt.getMinutes() + dibsConfig.dibs_remaining_minutes,
    );

    await db
      .insertInto(TABLE_NAMES.MERCENARY_DIBS)
      .values({
        id: randomUUID(),
        contract_id: contractId,
        guild_id: guildId,
        merc_discord_id: interaction.user.id,
        target_torn_id: targetName,
        claimed_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        status: "active",
        created_at: new Date().toISOString(),
      })
      .execute();

    await interaction.reply({
      content: `✅ Claimed **${targetName}** - expires in ${dibsConfig.dibs_remaining_minutes} minutes`,
      flags: MessageFlags.Ephemeral,
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      "Mercenary Dibs Claim",
      `${interaction.user.username} claimed target: ${targetName}`,
    );
  } catch (error) {
    await logGuildError(
      guildId,
      interaction.client,
      "Mercenary Dibs Error",
      error instanceof Error ? error : String(error),
      `Failed to claim target: ${targetName}`,
    );
    await interaction.reply({
      content: "❌ Failed to claim target",
      flags: MessageFlags.Ephemeral,
    });
  }
}
