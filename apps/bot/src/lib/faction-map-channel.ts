import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { db } from "@sentinel/database";
import { logger } from "./logger.js";
import { createBaseEmbed, EMBED_COLORS } from "./embeds.js";

const ITEMS_PER_PAGE = 15;

export interface FactionMappingRecord {
  factionId: number;
  factionName: string | null;
  memberRoleIds: string[];
  leaderRoleIds: string[];
}

/**
 * Purges all historical or stray messages in a dedicated channel, keeping only the active status message.
 */
async function purgeChannelHistoricalMessages(
  channel: TextChannel,
  keepMessageId: string,
): Promise<void> {
  try {
    const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!fetched || fetched.size === 0) return;

    const toDelete = fetched.filter((m) => m.id !== keepMessageId);
    if (toDelete.size === 0) return;

    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const bulkDeleteable = toDelete.filter((m) => m.createdTimestamp > fourteenDaysAgo);
    const olderDeleteable = toDelete.filter((m) => m.createdTimestamp <= fourteenDaysAgo);

    if (bulkDeleteable.size > 0) {
      await channel.bulkDelete(bulkDeleteable, true).catch(() => {});
    }

    for (const [, oldMsg] of olderDeleteable) {
      await oldMsg.delete().catch(() => {});
    }
  } catch (err) {
    logger.warn(`Failed to purge historical messages in channel ${channel.id}:`, err);
  }
}

/**
 * Builds the paginated embed and action row buttons for the Faction Directory.
 */
export function buildFactionDirectoryPayload(
  guildId: string,
  mappings: FactionMappingRecord[],
  page = 1,
  itemsPerPage = ITEMS_PER_PAGE,
) {
  const totalPages = Math.max(1, Math.ceil(mappings.length / itemsPerPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pageMappings = mappings.slice(startIndex, startIndex + itemsPerPage);

  const factionLines = pageMappings.map((m) => {
    const name = m.factionName || `Faction ${m.factionId}`;
    const url = `https://www.torn.com/factions.php?step=profile&ID=${m.factionId}`;

    return `[**${name}** [${m.factionId}]](${url})`;
  });

  const description =
    mappings.length === 0
      ? "No active faction role mappings configured."
      : factionLines.join("\n\n");

  const embed = createBaseEmbed(
    "Faction Directory",
    description,
    EMBED_COLORS.PRIMARY,
  );

  if (totalPages > 1) {
    embed.setFooter({
      text: `Sentinel • Page ${currentPage} of ${totalPages} • Total: ${mappings.length} Factions`,
    });
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`faction_dir_page:${guildId}:${currentPage - 1}`)
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage <= 1);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`faction_dir_info:${guildId}`)
      .setLabel(`${currentPage} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`faction_dir_page:${guildId}:${currentPage + 1}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage >= totalPages);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      prevButton,
      pageIndicator,
      nextButton,
    );

    components.push(row);
  }

  return { embeds: [embed], components };
}

/**
 * Handles interactive button pagination clicks for the Faction Directory.
 */
export async function handleFactionDirectoryButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    if (!interaction.customId.startsWith("faction_dir_page:")) return;

    const parts = interaction.customId.split(":");
    const targetGuildId = parts[1];
    const targetPage = parseInt(parts[2], 10) || 1;

    const config = await db.guildConfig.findUnique({
      where: { guildId: targetGuildId },
      include: { factionRoleMappings: { where: { enabled: true } } },
    });

    if (!config) {
      await interaction.reply({
        content: "Guild configuration not found.",
        ephemeral: true,
      });
      return;
    }

    const payload = buildFactionDirectoryPayload(
      targetGuildId,
      config.factionRoleMappings,
      targetPage,
    );

    await interaction.update(payload);
  } catch (err) {
    logger.error("Failed to handle faction directory button pagination:", err);
  }
}

/**
 * Maintains the Faction Map Channel by updating or replacing the status embed.
 * Purges all historical/stray messages in the channel to keep it strictly dedicated.
 */
export async function updateFactionMapChannel(
  client: Client,
  guildId?: string,
): Promise<void> {
  try {
    const configs = guildId
      ? await db.guildConfig.findMany({
          where: { guildId },
          include: { factionRoleMappings: { where: { enabled: true } } },
        })
      : await db.guildConfig.findMany({
          where: { factionListChannelId: { not: null } },
          include: { factionRoleMappings: { where: { enabled: true } } },
        });

    for (const config of configs) {
      if (!config.factionListChannelId) continue;

      try {
        const channel = (await client.channels
          .fetch(config.factionListChannelId)
          .catch(() => null)) as TextChannel | null;

        if (!channel || !(channel instanceof TextChannel)) {
          logger.warn(
            `Faction list channel ${config.factionListChannelId} for guild ${config.guildId} not found or invalid.`,
          );
          continue;
        }

        const payload = buildFactionDirectoryPayload(
          config.guildId,
          config.factionRoleMappings,
          1,
        );

        let activeMsgId: string | null = null;

        // Try to edit existing tracked message in place to avoid channel spam
        let existingMsg = config.factionListMessageIds[0]
          ? await channel.messages
              .fetch(config.factionListMessageIds[0])
              .catch(() => null)
          : null;

        if (existingMsg) {
          await existingMsg.edit({
            embeds: payload.embeds,
            components: payload.components,
          });
          activeMsgId = existingMsg.id;
        } else {
          const sentMsg = await channel.send({
            embeds: payload.embeds,
            components: payload.components,
          });
          activeMsgId = sentMsg.id;

          await db.guildConfig.update({
            where: { guildId: config.guildId },
            data: {
              factionListMessageIds: [sentMsg.id],
            },
          });
        }

        // Purge all historical or stray messages in the dedicated channel except active directory message
        if (activeMsgId) {
          await purgeChannelHistoricalMessages(channel, activeMsgId);
        }
      } catch (err) {
        logger.error(
          `Failed to update Faction Map channel for guild ${config.guildId}:`,
          err,
        );
      }
    }
  } catch (error) {
    logger.error("Error in updateFactionMapChannel:", error);
  }
}
