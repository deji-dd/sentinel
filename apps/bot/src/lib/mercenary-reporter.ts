import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { Logger } from "./logger.js";
import { EmbedBuilder, type Client } from "discord.js";

const logger = new Logger("MercenaryReporter");

/**
 * Generate and post a mercenary contract completion report to the configured payout or audit channel.
 * Computes billing totals for the client and payment breakdowns for each active mercenary.
 */
export async function postContractReport(
  client: Client,
  contractId: string,
  guildId: string,
): Promise<void> {
  try {
    const contract = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
      .selectAll()
      .where("id", "=", contractId)
      .executeTakeFirst();

    if (!contract) {
      logger.error(`Contract ${contractId} not found when generating completion report.`);
      return;
    }

    // Fetch config for payout channel
    const config = await db
      .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
      .selectAll()
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    const targetChannelId = config?.payout_channel_id || config?.audit_channel_id;
    if (!targetChannelId) {
      logger.warn(`No payout or audit channel configured for guild ${guildId}. Report skipped.`);
      return;
    }

    const channel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.error(`Resolved channel ${targetChannelId} is not a valid text channel.`);
      return;
    }

    // Fetch all verified hits from vault
    const hits = await db
      .selectFrom(TABLE_NAMES.MERCENARY_VERIFICATION_VAULT)
      .selectAll()
      .where("contract_id", "=", contractId)
      .where("result", "=", "verified")
      .execute();

    if (hits.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle(`Mercenary Contract Finished: ${contract.title}`)
        .setDescription(`No verified hits were recorded for this contract.`)
        .setTimestamp();
      await channel.send({ embeds: [emptyEmbed] }).catch(() => {});
      return;
    }

    // Calculate totals
    const totalHits = hits.length;
    const totalCost = hits.reduce((sum, h) => sum + (h.payout_amount || 0), 0);

    // Group by mercenary
    const mercStats = new Map<string, { name: string; tornId: string; hits: number; payout: number }>();
    for (const hit of hits) {
      const mercId = hit.merc_discord_id || "unknown";
      const current = mercStats.get(mercId) || {
        name: hit.merc_name || "Unknown Merc",
        tornId: hit.merc_torn_id || "Unknown ID",
        hits: 0,
        payout: 0,
      };
      current.hits += 1;
      current.payout += hit.payout_amount || 0;
      mercStats.set(mercId, current);
    }

    // Format ASCII text report
    let reportText = `MERCENARY CONTRACT COMPLETION REPORT\n`;
    reportText += `====================================\n\n`;
    reportText += `Contract Title: ${contract.title}\n`;
    reportText += `Target Faction: ${contract.faction_name || "Unknown"} [${contract.faction_id || "N/A"}]\n`;
    reportText += `Completed At:   ${new Date().toUTCString()}\n\n`;
    reportText += `BILLING SUMMARY FOR CLIENT\n`;
    reportText += `--------------------------\n`;
    reportText += `Total Hits:     ${totalHits}\n`;
    reportText += `Total Bill:     $${totalCost.toLocaleString()}\n\n`;
    reportText += `PAYMENT BREAKDOWN PER MERCENARY\n`;
    reportText += `--------------------------------\n`;
    reportText += `Name [Torn ID] - Hits Count - Payout Due\n`;
    reportText += `--------------------------------\n`;

    for (const [_, stats] of mercStats) {
      reportText += `${stats.name} [${stats.tornId}] - ${stats.hits} hits - $${stats.payout.toLocaleString()}\n`;
    }

    reportText += `\nEnd of Report.`;

    const buffer = Buffer.from(reportText, "utf-8");
    const sanitizedTitle = contract.title.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const filename = `mercenary_report_${sanitizedTitle}.txt`;

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(`Mercenary Contract Completed: ${contract.title}`)
      .setDescription(
        `**Client Bill Summary**:\n` +
        `• Target Faction: **${contract.faction_name || "Unknown"} [${contract.faction_id || "N/A"}]**\n` +
        `• Total Verified Hits: **${totalHits}**\n` +
        `• Total Amount Owed: **$${totalCost.toLocaleString()}**\n\n` +
        `Detailed payment information per mercenary has been generated and attached as a text file.`
      )
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      files: [{ attachment: buffer, name: filename }],
    });

    logger.success(`Posted completion report for contract ${contract.title} to channel ${targetChannelId}`);
  } catch (err) {
    logger.error(`Failed to post contract completion report for ${contractId}:`, err);
  }
}
