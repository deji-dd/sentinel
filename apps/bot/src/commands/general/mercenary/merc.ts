import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import { randomUUID } from "crypto";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { logGuildAction, logGuildError } from "../../../lib/guild-logger.js";

export const data = new SlashCommandBuilder()
  .setName("merc")
  .setDescription("Manage mercenary registration and dibs")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("register")
      .setDescription("Register as a mercenary for the dibs system"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("deregister")
      .setDescription("Deregister from the mercenary dibs system"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Check your merc registration status"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "register":
      return handleRegister(interaction);
    case "deregister":
      return handleDeregister(interaction);
    case "status":
      return handleStatus(interaction);
  }
}

async function handleRegister(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  const discordId = interaction.user.id;
  const discordName = interaction.user.username;

  if (!guildId) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Error")
          .setDescription("This command can only be used in a guild."),
      ],
    });
    return;
  }

  try {
    // Check if already registered
    const existing = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", discordId)
      .executeTakeFirst();

    if (existing && existing.is_active) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("⚠️ Already Registered")
            .setDescription("You are already registered as a mercenary."),
        ],
      });
      return;
    }

    // Register or reactivate
    const recordId = existing?.id || randomUUID();
    const now = new Date().toISOString();

    if (existing) {
      // Reactivate
      await db
        .updateTable(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
        .set({
          is_active: 1,
          deregistered_at: null,
          updated_at: now,
        })
        .where("id", "=", recordId)
        .execute();
    } else {
      // Create new registration
      await db
        .insertInto(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
        .values({
          id: recordId,
          guild_id: guildId,
          discord_id: discordId,
          is_active: 1,
          registered_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Registered",
      description: `${interaction.user.toString()} registered as a mercenary.`,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle("✅ Registered Successfully")
          .setDescription("You are now registered for the dibs system.")
          .addFields({
            name: "What's Next?",
            value:
              "When a faction war starts and the bot populates targets, you'll see the dibs list and can claim targets.",
          }),
      ],
    });
  } catch (error) {
    console.error("[/merc register] Error:", error);
    await logGuildError(
      guildId,
      interaction.client,
      "Merc Registration Error",
      error instanceof Error ? error : String(error),
      `Failed to register ${interaction.user.toString()}`,
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Registration Failed")
          .setDescription(
            error instanceof Error
              ? error.message
              : "An error occurred while registering.",
          ),
      ],
    });
  }
}

async function handleDeregister(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  const discordId = interaction.user.id;

  if (!guildId) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Error")
          .setDescription("This command can only be used in a guild."),
      ],
    });
    return;
  }

  try {
    // Check if registered
    const existing = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", discordId)
      .executeTakeFirst();

    if (!existing || !existing.is_active) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("⚠️ Not Registered")
            .setDescription("You are not registered as a mercenary."),
        ],
      });
      return;
    }

    // Deregister
    const now = new Date().toISOString();
    await db
      .updateTable(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .set({
        is_active: 0,
        deregistered_at: now,
        updated_at: now,
      })
      .where("id", "=", existing.id)
      .execute();

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Deregistered",
      description: `${interaction.user.toString()} deregistered from the mercenary system.`,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle("✅ Deregistered Successfully")
          .setDescription("You have been removed from the dibs system."),
      ],
    });
  } catch (error) {
    console.error("[/merc deregister] Error:", error);
    await logGuildError(
      guildId,
      interaction.client,
      "Merc Deregistration Error",
      error instanceof Error ? error : String(error),
      `Failed to deregister ${interaction.user.toString()}`,
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Deregistration Failed")
          .setDescription(
            error instanceof Error
              ? error.message
              : "An error occurred while deregistering.",
          ),
      ],
    });
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  const discordId = interaction.user.id;

  if (!guildId) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Error")
          .setDescription("This command can only be used in a guild."),
      ],
    });
    return;
  }

  try {
    const registration = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", discordId)
      .executeTakeFirst();

    if (!registration) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("⚠️ Not Registered")
            .setDescription("You are not registered as a mercenary.")
            .addFields({
              name: "Register Now",
              value: "Use `/merc register` to join the dibs system.",
            }),
        ],
      });
      return;
    }

    const statusEmoji = registration.is_active ? "✅" : "❌";
    const statusText = registration.is_active ? "Active" : "Inactive";

    // Get active dibs count
    const activeDibs = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
      .selectAll()
      .where("merc_discord_id", "=", discordId)
      .where("status", "=", "active")
      .execute();

    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const maxDibs = dibsConfig?.max_active_dibs_per_person ?? 5;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle(`${statusEmoji} Mercenary Status`)
          .addFields(
            {
              name: "Registration Status",
              value: statusText,
              inline: true,
            },
            {
              name: "Registered Since",
              value: registration.registered_at
                ? new Date(registration.registered_at).toLocaleDateString()
                : "Unknown",
              inline: true,
            },
            {
              name: "Active Dibs",
              value: `${activeDibs.length}/${maxDibs}`,
              inline: true,
            },
          ),
      ],
    });
  } catch (error) {
    console.error("[/merc status] Error:", error);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("❌ Error")
          .setDescription(
            error instanceof Error
              ? error.message
              : "An error occurred while checking status.",
          ),
      ],
    });
  }
}
