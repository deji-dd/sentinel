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
  Client,
  ButtonStyle,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from "discord.js";
import { TABLE_NAMES, encryptApiKey, decryptApiKey } from "@sentinel/shared";
import { db } from "./db-client.js";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}
import {
  logGuildError,
  logGuildSuccess,
  logGuildAction,
} from "./guild-logger.js";
import { randomUUID } from "crypto";
import { validateTornApiKey, tornApi } from "../services/torn-client.js";
import { runMercenaryTrackerGuildSync } from "./mercenary-tracker.js";

async function getApiKeyForGuild(guildId: string): Promise<string | null> {
  const registeredMercs = await db
    .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
    .select(["api_key"])
    .where("guild_id", "=", guildId)
    .where("is_active", "=", 1)
    .where("api_key", "is not", null)
    .execute();

  const apiKeys = registeredMercs
    .map((m) => {
      try {
        return decryptApiKey(m.api_key!, ENCRYPTION_KEY);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];

  if (apiKeys.length === 0) {
    const primaryKeyRow = await db
      .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
      .select(["api_key_encrypted"])
      .where("guild_id", "=", guildId)
      .where("is_primary", "=", 1)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (primaryKeyRow) {
      try {
        const primaryKey = decryptApiKey(
          primaryKeyRow.api_key_encrypted,
          ENCRYPTION_KEY,
        );
        if (primaryKey) apiKeys.push(primaryKey);
      } catch {
        // Decryption failed, skip key
      }
    }
  }
  return apiKeys[0] || null;
}

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
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Error")
          .setDescription("Invalid contract ID")
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Not Registered")
            .setDescription(
              "You must register as a mercenary first. Use the Register button.",
            )
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("Dibs system not configured")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("Limit Reached")
            .setDescription(
              `You already have ${activeDibs.length} active dib${activeDibs.length !== 1 ? "s" : ""} (max: ${dibsConfig.max_active_dibs_per_person})`,
            )
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if this is a direct claim button click
    if (interaction.customId.startsWith("merc_claim_direct_")) {
      const parts = interaction.customId.split("_");
      // Format: merc_claim_direct_{contractId}_{targetTornId}_{targetName}
      const cId = parts[3];
      const targetTornId = parts[4];
      const targetName = parts.slice(5).join("_");

      const apiKey = await getApiKeyForGuild(guildId);
      let targetUntil: number | null = null;
      if (apiKey) {
        try {
          const userRes = (await tornApi.get("/user/{id}", {
            apiKey,
            pathParams: { id: targetTornId },
          })) as any;
          if (userRes?.status?.state === "Hospital" && userRes.status.until) {
            targetUntil = userRes.status.until;
          }
        } catch (e) {
          console.error("Failed to fetch target status during claim:", e);
        }
      }

      const expiresAt = new Date();
      if (targetUntil) {
        expiresAt.setTime(
          targetUntil * 1000 + dibsConfig.dibs_remaining_minutes * 60000,
        );
      } else {
        expiresAt.setMinutes(
          expiresAt.getMinutes() + dibsConfig.dibs_remaining_minutes,
        );
      }

      let success = false;
      let existingClaimant: string | null = null;

      await db.transaction().execute(async (trx) => {
        // Check if already claimed inside the transaction to prevent race conditions
        const existingClaim = await trx
          .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
          .selectAll()
          .where("contract_id", "=", cId)
          .where("target_torn_id", "=", targetTornId)
          .where("status", "=", "active")
          .executeTakeFirst();

        if (existingClaim) {
          existingClaimant = existingClaim.merc_discord_id;
          return;
        }

        await trx
          .insertInto(TABLE_NAMES.MERCENARY_DIBS)
          .values({
            id: randomUUID(),
            contract_id: cId,
            guild_id: guildId,
            merc_discord_id: interaction.user.id,
            target_torn_id: targetTornId,
            target_name: targetName,
            claimed_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            status: "active",
            created_at: new Date().toISOString(),
          })
          .execute();

        success = true;
      });

      if (!success) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("Already Claimed")
              .setDescription(
                `Target **${targetName}** has already been claimed by another mercenary (<@${existingClaimant}>).`,
              )
              .setFooter({ text: "Sentinel" })
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Reconstruct components with disabled Claimed button
      const claimButton = new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setLabel("Claimed")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const attackButton = new ButtonBuilder()
        .setLabel("Attack")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://www.torn.com/page.php?sid=attack&user2ID=${targetTornId}`,
        );

      const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        claimButton,
        attackButton,
      );

      // Reconstruct embed
      const existingEmbed = interaction.message.embeds[0];
      if (existingEmbed) {
        const newEmbed = EmbedBuilder.from(existingEmbed);
        let description = existingEmbed.description || "";
        description = description.replace(
          "**Claimed By**: None",
          `**Claimed By**: <@${interaction.user.id}>`,
        );
        newEmbed.setDescription(description);
        newEmbed.setColor(0xef4444); // red color for claimed

        await interaction.update({
          embeds: [newEmbed],
          components: [newRow],
        });
      } else {
        await interaction.update({
          components: [newRow],
        });
      }

      // Trigger target tracker updates immediately
      void runMercenaryTrackerGuildSync(interaction.client, guildId).catch(
        console.error,
      );
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("Contract not found")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("Could not find targets in message")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("No targets available")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Parse targets
    const targetLines = targetField.value.split("\n");
    const targets = targetLines
      .filter((line) => line.startsWith("•") || /^\d+\./.test(line))
      .slice(0, 25) // Max 25 options for select menu
      .map((line) => {
        const nameMatch = line.match(/\*\*([^*]+)\*\*/);
        const name = nameMatch ? nameMatch[1] : line;
        let id = "";
        const xidMatch = line.match(/XID=(\d+)/i);
        const u2idMatch = line.match(/user2ID=(\d+)/i);
        const bracketMatch = line.match(/\[(\d+)\]/);
        if (xidMatch) {
          id = xidMatch[1];
        } else if (u2idMatch) {
          id = u2idMatch[1];
        } else if (bracketMatch) {
          id = bracketMatch[1];
        }
        return {
          label: name.substring(0, 100), // Discord limit
          value: `${contractId}|${id}|${name}`, // Store contract + id + name
        };
      });

    if (targets.length === 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("No targets available")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
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
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("Claim")
          .setDescription(
            "Select a target from the dropdown menu below to claim.",
          )
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
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
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Error")
          .setDescription("An error occurred")
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
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

  const parts = selected.split("|");
  const contractId = parts[0];
  const targetTornId = parts[1];
  const targetName = parts.slice(2).join("|");
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    const dibsConfig = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!dibsConfig) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Error")
            .setDescription("Dibs system not configured")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const apiKey = await getApiKeyForGuild(guildId);
    let targetUntil: number | null = null;
    if (apiKey && targetTornId) {
      try {
        const userRes = (await tornApi.get("/user/{id}", {
          apiKey,
          pathParams: { id: targetTornId },
        })) as any;
        if (userRes?.status?.state === "Hospital" && userRes.status.until) {
          targetUntil = userRes.status.until;
        }
      } catch (e) {
        console.error("Failed to fetch target status during claim:", e);
      }
    }

    const expiresAt = new Date();
    if (targetUntil) {
      expiresAt.setTime(
        targetUntil * 1000 + dibsConfig.dibs_remaining_minutes * 60000,
      );
    } else {
      expiresAt.setMinutes(
        expiresAt.getMinutes() + dibsConfig.dibs_remaining_minutes,
      );
    }

    await db
      .insertInto(TABLE_NAMES.MERCENARY_DIBS)
      .values({
        id: randomUUID(),
        contract_id: contractId,
        guild_id: guildId,
        merc_discord_id: interaction.user.id,
        target_torn_id: targetTornId || targetName,
        target_name: targetName || targetTornId,
        claimed_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        status: "active",
        created_at: new Date().toISOString(),
      })
      .execute();

    const desc = targetUntil
      ? `Claimed target **${targetName || targetTornId}** - expires ${dibsConfig.dibs_remaining_minutes} minutes after they leave the hospital`
      : `Claimed target **${targetName || targetTornId}** - expires in ${dibsConfig.dibs_remaining_minutes} minutes`;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle("Target Claimed")
          .setDescription(desc)
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });

    await logGuildSuccess(
      guildId,
      interaction.client,
      "Mercenary Dibs Claim",
      `${interaction.user.username} claimed target: ${targetName}`,
    );

    // Trigger target tracker updates immediately
    void runMercenaryTrackerGuildSync(interaction.client, guildId).catch(
      console.error,
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
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Error")
          .setDescription("Failed to claim target")
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Helper to parse comma-separated or JSON list of strings
 */
function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Ensure the permanent mercenary registration panel is posted in the configured channel
 */
export async function ensureMercRegistrationPanel(
  client: Client,
  guildId: string,
): Promise<void> {
  const config = await db
    .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
    .select(["merc_registration_channel_id", "merc_registration_message_id"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!config || !config.merc_registration_channel_id) return;

  const channel = await client.channels
    .fetch(config.merc_registration_channel_id)
    .catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("Mercenary Registration")
    .setDescription(
      "Register as a mercenary for our faction.\n\n" +
        "Click the button below to verify your Torn account using a public API key. " +
        "This allows us to verify your Torn identity, track targets, and automatically assign roles.",
    )
    .setFooter({ text: "Sentinel" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("merc_register_button")
      .setLabel("Register")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("merc_unregister_button")
      .setLabel("Unregister")
      .setStyle(ButtonStyle.Danger),
  );

  if (config.merc_registration_message_id) {
    const existingMsg = await channel.messages
      .fetch(config.merc_registration_message_id)
      .catch(() => null);
    if (existingMsg) {
      await existingMsg
        .edit({ embeds: [embed], components: [row] })
        .catch(console.error);
      return;
    }
  }

  const newMsg = await channel
    .send({ embeds: [embed], components: [row] })
    .catch(console.error);
  if (newMsg) {
    await db
      .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
      .set({ merc_registration_message_id: newMsg.id })
      .where("guild_id", "=", guildId)
      .execute();
  }
}

/**
 * Ensure all mercenary registration panels exist and are up to date for all configured guilds
 */
export async function ensureAllMercRegistrationPanels(
  client: Client,
): Promise<void> {
  const configs = await db
    .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
    .select(["guild_id", "merc_registration_channel_id"])
    .where("merc_registration_channel_id", "is not", null)
    .execute();

  for (const config of configs) {
    try {
      await ensureMercRegistrationPanel(client, config.guild_id);
    } catch (e) {
      console.error(
        `Failed to ensure mercenary registration panel for guild ${config.guild_id}:`,
        e,
      );
    }
  }
}

/**
 * Handle mercenary registration button click - pops up a key entry modal
 */
export async function handleMercRegisterButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    const existing = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", interaction.user.id)
      .where("is_active", "=", 1)
      .executeTakeFirst();

    if (existing) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("merc_update_key_button")
          .setLabel("Update API Key")
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("Already Registered")
            .setDescription(
              `You are already registered as mercenary **${existing.torn_name} [${existing.torn_id}]**.\n\nIf you want to update your API key, click the button below.`,
            )
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    console.error("Error checking existing mercenary registration:", error);
  }

  const modal = new ModalBuilder()
    .setCustomId("merc_register_modal")
    .setTitle("Mercenary Key Verification");

  const keyInput = new TextInputBuilder()
    .setCustomId("torn_api_key")
    .setLabel("Torn Public API Key")
    .setPlaceholder("Enter your 16-character public API key")
    .setMinLength(16)
    .setMaxLength(16)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    keyInput,
  );
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

/**
 * Handle mercenary update key button click - pops up the key entry modal directly
 */
export async function handleMercUpdateKeyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("merc_register_modal")
    .setTitle("Update Mercenary API Key");

  const keyInput = new TextInputBuilder()
    .setCustomId("torn_api_key")
    .setLabel("New Torn Public API Key")
    .setPlaceholder("Enter your 16-character public API key")
    .setMinLength(16)
    .setMaxLength(16)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    keyInput,
  );
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

/**
 * Handle mercenary registration modal submission - verifies key and registers user
 */
export async function handleMercRegisterModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const apiKey = interaction.fields.getTextInputValue("torn_api_key");

  if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Invalid API Key")
          .setDescription("API Key must be exactly 16 alphanumeric characters.")
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
    });
    return;
  }

  try {
    // 1. Validate key (merc key only needs Public Access, level >= 1)
    const keyInfo = await validateTornApiKey(apiKey, 1);
    const tornId = keyInfo.playerId;

    // 2. Fetch basic profile details
    const userRes = await tornApi.get<any>("/user", {
      apiKey,
      queryParams: {
        selections: ["profile", "faction"],
      },
    });

    const tornName = userRes.profile?.name || "Unknown";

    // 3. Save to sentinel_mercenary_registered_mercs
    const existing = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("discord_id", "=", interaction.user.id)
      .executeTakeFirst();

    const encryptedKey = encryptApiKey(apiKey, ENCRYPTION_KEY);
    const now = new Date().toISOString();
    const recordId = existing?.id || randomUUID();

    if (existing) {
      await db
        .updateTable(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
        .set({
          torn_id: String(tornId),
          torn_name: tornName,
          api_key: encryptedKey,
          is_active: 1,
          deregistered_at: null,
          updated_at: now,
        })
        .where("id", "=", recordId)
        .execute();
    } else {
      await db
        .insertInto(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
        .values({
          id: recordId,
          guild_id: guildId,
          discord_id: interaction.user.id,
          torn_id: String(tornId),
          torn_name: tornName,
          api_key: encryptedKey,
          is_active: 1,
          registered_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    // 4. Assign role(s) configured in sentinel_mercenary_config
    const config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .select(["merc_role_ids_json"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const roleIds = parseTextArray(config?.merc_role_ids_json);
    const rolesAdded: string[] = [];

    if (roleIds.length > 0) {
      try {
        const member = await interaction.guild!.members.fetch(
          interaction.user.id,
        );
        for (const roleId of roleIds) {
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId);
            rolesAdded.push(roleId);
          }
        }
      } catch (roleError) {
        console.error("Failed to assign mercenary roles:", roleError);
      }
    }

    // 5. Ephemeral confirmation
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Registration Successful")
      .setDescription(
        `Registered successfully as mercenary **${tornName} [${tornId}]**.`,
      )
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    if (rolesAdded.length > 0) {
      embed.addFields({
        name: "Assigned Roles",
        value: rolesAdded.map((id) => `<@&${id}>`).join(", "),
      });
    }

    await interaction.editReply({ embeds: [embed] });

    // 6. Log the action
    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Registered",
      description: `${interaction.user.toString()} registered as a mercenary.\nName: **${tornName} [${tornId}]**\nFaction: **${userRes.faction?.name || "None"}**`,
    });
  } catch (error) {
    console.error("[Merc Register Interaction] Error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Verification Failed")
          .setDescription(errorMsg)
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
    });
  }
}

/**
 * Handle mercenary unregistration button click - removes active status and roles
 */
export async function handleMercUnregisterButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  const discordId = interaction.user.id;

  if (!guildId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if registered and active
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
            .setTitle("Not Registered")
            .setDescription("You are not registered as a mercenary.")
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
      });
      return;
    }

    // Deregister in DB
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

    // Attempt to strip mercenary roles immediately
    const config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .select(["merc_role_ids_json"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (config?.merc_role_ids_json) {
      try {
        const roleIds = parseTextArray(config.merc_role_ids_json);
        if (roleIds.length > 0) {
          const member = await interaction.guild!.members.fetch(discordId);
          for (const roleId of roleIds) {
            if (member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId);
            }
          }
        }
      } catch (roleError) {
        console.error(
          "Failed to remove mercenary roles on unregister:",
          roleError,
        );
      }
    }

    await logGuildAction(guildId, interaction.client, {
      title: "Mercenary Deregistered",
      description: `${interaction.user.toString()} deregistered from the mercenary system.`,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle("Deregistered Successfully")
          .setDescription("You have been removed from the mercenary system.")
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
    });
  } catch (error) {
    console.error("[Merc Unregister Button] Error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("Deregistration Failed")
          .setDescription(errorMsg)
          .setFooter({ text: "Sentinel" })
          .setTimestamp(),
      ],
    });
  }
}

/**
 * Handle mercenary attack/verify button click
 * Sends ephemeral attack link and immediately triggers verification check
 */
export async function handleMercAttackButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split("_");
  // Format: merc_attack_direct_{contractId}_{targetTornId}_{targetName}
  const cId = parts[3];
  const targetTornId = parts[4];
  const targetName = parts.slice(5).join("_");
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
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Not Registered")
            .setDescription(
              "You must register as a mercenary first. Use the Register button.",
            )
            .setFooter({ text: "Sentinel" })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if there is an active claim for this target under this contract
    const existingClaim = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
      .selectAll()
      .where("contract_id", "=", cId)
      .where("target_torn_id", "=", targetTornId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!existingClaim) {
      // Create a short-lived (5 minutes) claim automatically so verification will track it
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 5);

      await db
        .insertInto(TABLE_NAMES.MERCENARY_DIBS)
        .values({
          id: randomUUID(),
          contract_id: cId,
          guild_id: guildId,
          merc_discord_id: interaction.user.id,
          target_torn_id: targetTornId,
          target_name: targetName,
          claimed_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          status: "active",
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    // Send ephemeral reply with attack link
    await interaction.reply({
      content:
        `**Attack Link**: https://www.torn.com/page.php?sid=attack&user2ID=${targetTornId}\n` +
        `*Sentinel is verifying your outgoing attacks in the background.*`,
      flags: MessageFlags.Ephemeral,
    });

    // Proactively trigger target tracker to run verification
    void runMercenaryTrackerGuildSync(interaction.client, guildId).catch(
      console.error,
    );
  } catch (error) {
    console.error("Error in handleMercAttackButton:", error);
    await interaction
      .reply({
        content: "An error occurred while initiating the attack.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

/**
 * Handle page change buttons on the Okay/FFA targets list message
 */
export async function handleMercPageButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split("_");
  // Format: merc_page_prev_{contractId}_{currentPage} or merc_page_next_{contractId}_{currentPage}
  const action = parts[2]; // "prev" or "next"
  const contractId = parts[3];
  const currentPage = parseInt(parts[4], 10) || 0;

  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    // 1. Fetch the contract details
    const contract = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("id", "=", contractId)
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!contract || !contract.faction_id) {
      await interaction.reply({
        content: "Contract not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer the interaction update so it doesn't time out
    await interaction.deferUpdate();

    // 2. Fetch config and API keys
    const config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!config) return;

    // Fetch registered mercenary key or primary key
    const registeredMercs = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .select(["api_key"])
      .where("guild_id", "=", guildId)
      .where("is_active", "=", 1)
      .where("api_key", "is not", null)
      .execute();

    const apiKeys = registeredMercs
      .map((m) => {
        try {
          return decryptApiKey(m.api_key!, ENCRYPTION_KEY);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];

    if (apiKeys.length === 0) {
      const primaryKeyRow = await db
        .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
        .select(["api_key_encrypted"])
        .where("guild_id", "=", guildId)
        .where("is_primary", "=", 1)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (primaryKeyRow) {
        try {
          const primaryKey = decryptApiKey(
            primaryKeyRow.api_key_encrypted,
            ENCRYPTION_KEY,
          );
          if (primaryKey) apiKeys.push(primaryKey);
        } catch {
          // Decryption failed, skip key
        }
      }
    }

    if (apiKeys.length === 0) return;
    const apiKey = apiKeys[0];

    // 3. Fetch faction members
    const membersResponse = await tornApi.get("/faction/{id}/members", {
      apiKey,
      pathParams: { id: String(contract.faction_id) },
    });

    const members = (membersResponse.members || []) as any[];

    // Extract target roles filters
    let targetRoles: string[] = [];
    if (contract.target_roles_json) {
      try {
        const parsed = JSON.parse(contract.target_roles_json);
        if (Array.isArray(parsed)) targetRoles = parsed;
      } catch {
        // Invalid JSON in target_roles_json, use empty array
      }
    }

    // Fetch active claims
    const activeDibs = await db
      .selectFrom(TABLE_NAMES.MERCENARY_DIBS)
      .selectAll()
      .where("contract_id", "=", contract.id)
      .where("status", "=", "active")
      .execute();

    // 4. Filter okay (out of hospital) targets
    const okayTargets: any[] = [];
    for (const member of members) {
      if (
        member.status?.state === "Abroad" ||
        member.status?.state === "Jail"
      ) {
        continue;
      }

      if (contract.min_level !== null && member.level < contract.min_level)
        continue;
      if (contract.max_level !== null && member.level > contract.max_level)
        continue;

      if (targetRoles.length > 0 && !targetRoles.includes(member.position))
        continue;

      // Scope / status filter
      const lastActionStatus = member.last_action?.status;
      const awayMinutes = member.last_action?.timestamp
        ? Math.floor((Date.now() - member.last_action.timestamp * 1000) / 60000)
        : 0;

      let matchesScope = true;
      if (contract.target_scope === "offline_only") {
        if (lastActionStatus !== "Offline") matchesScope = false;
        if (
          contract.idle_minutes !== null &&
          awayMinutes < contract.idle_minutes
        )
          matchesScope = false;
      } else if (contract.target_scope === "offline_and_idle") {
        const isOfflineOrIdle =
          lastActionStatus === "Offline" || lastActionStatus === "Idle";
        if (!isOfflineOrIdle) matchesScope = false;
        if (
          contract.idle_minutes !== null &&
          awayMinutes < contract.idle_minutes
        )
          matchesScope = false;
      }

      if (!matchesScope) continue;

      // Check claim status
      const claim = activeDibs.some(
        (d) => String(d.target_torn_id) === String(member.id),
      );

      if (member.status?.state !== "Hospital" && !claim) {
        okayTargets.push(member);
      }
    }

    // 5. Calculate new page
    const totalPages = Math.ceil(okayTargets.length / 10) || 1;
    let newPage = action === "next" ? currentPage + 1 : currentPage - 1;
    if (newPage >= totalPages) newPage = totalPages - 1;
    if (newPage < 0) newPage = 0;

    // 6. Generate new elements and edit the message
    const pageTargets = okayTargets.slice(newPage * 10, (newPage + 1) * 10);

    const targetListText =
      pageTargets.length > 0
        ? pageTargets
            .map((m, index) => {
              const idx = newPage * 10 + index + 1;
              const lastAction = m.last_action?.status || "Unknown";
              return `${idx}. **${m.name}** [Lvl ${m.level}] - Okay (${lastAction}) · [Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`;
            })
            .join("\n")
        : "No eligible targets currently.";

    const ffaEmbed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`${contract.title} - Targets Listing`)
      .setDescription(`**Available Targets**:\n${targetListText}`)
      .setFooter({ text: `Sentinel • Page ${newPage + 1} of ${totalPages}` })
      .setTimestamp();

    const components: any[] = [];

    // Attack buttons removed per user request (link directly in text listing)

    if (totalPages > 1) {
      const prevButton = new ButtonBuilder()
        .setCustomId(`merc_page_prev_${contract.id}_${newPage}`)
        .setLabel("◀ Prev")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(newPage === 0);

      const nextButton = new ButtonBuilder()
        .setCustomId(`merc_page_next_${contract.id}_${newPage}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(newPage === totalPages - 1);

      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          prevButton,
          nextButton,
        ),
      );
    }

    await interaction.editReply({
      embeds: [ffaEmbed],
      components,
    });
  } catch (error) {
    console.error("Error in handleMercPageButton:", error);
  }
}
