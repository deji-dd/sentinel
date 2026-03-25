import { type Response } from "express";
import {
  EmbedBuilder,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import { TABLE_NAMES, getNextApiKey } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import { type AssistPayload } from "./assist-support.js";
import { type AssistRouteDeps } from "./assist-types.js";

type AssistTokenRow = {
  id: number;
  guild_id: string;
  discord_id: string;
};

type AssistConfigRow = {
  assist_channel_id: string;
  ping_role_id: string | null;
};

type SendAssistMessage = (options: MessageCreateOptions) => Promise<Message>;

type SharedEventContext = {
  payload: AssistPayload;
  token: AssistTokenRow;
  clientIp: string;
  clientUA: string | null;
  deps: AssistRouteDeps;
};

export async function handleAssistPatchEvent(
  context: SharedEventContext,
  res: Response,
): Promise<Response> {
  const { payload, token, clientIp, clientUA, deps } = context;

  const tracked = deps.getActiveTrackedAssist(payload.uuid);
  if (!tracked) {
    await deps.incrementAssistStrikeByUuid(
      payload.uuid,
      "invalid_patch_without_active_assist",
    );
    return res.status(409).json({
      error:
        "No active assist request exists for this token. Repeated invalid lifecycle updates will deactivate this token.",
    });
  }

  tracked.lastActivityAt = Date.now();
  const details = payload.details || "";
  const match = details.match(/(\d+)\s*->\s*(\d+)/);
  const updatedEmbed = EmbedBuilder.from(tracked.message.embeds[0]);
  let hasChanges = false;

  const normalizedStatus = deps.resolveStatusFieldValue(payload);
  if (normalizedStatus) {
    const statusField = updatedEmbed.data.fields?.find(
      (field) => field.name === "Status",
    );
    if (statusField?.value !== normalizedStatus) {
      deps.upsertEmbedField(updatedEmbed, "Status", normalizedStatus, true);
      hasChanges = true;
    }
  }

  const explicitCount = Number.isFinite(payload.attacker_count)
    ? Number(payload.attacker_count)
    : null;
  const parsedCountFromDetails = match ? Number.parseInt(match[2], 10) : null;
  const newCount = Number.isFinite(explicitCount)
    ? explicitCount
    : parsedCountFromDetails;

  if (Number.isFinite(newCount) && newCount !== tracked.attackerCount) {
    deps.upsertEmbedField(updatedEmbed, "Attackers", String(newCount), true);
    tracked.attackerCount = newCount;
    hasChanges = true;
  }

  if (
    payload.action === "attacker_count_unavailable" ||
    payload.attacker_count_state === "mobile_unavailable"
  ) {
    const attackersField = updatedEmbed.data.fields?.find(
      (field) => field.name === "Attackers",
    );
    const unavailableLabel =
      payload.attacker_count_state === "mobile_unavailable"
        ? "Unavailable (mobile)"
        : "Unavailable";
    if (attackersField?.value !== unavailableLabel) {
      deps.upsertEmbedField(updatedEmbed, "Attackers", unavailableLabel, true);
      tracked.attackerCount = null;
      hasChanges = true;
    }
  }

  const healthCurrent = payload.enemy_health_current;
  const healthMax = payload.enemy_health_max;
  const healthPercent = payload.enemy_health_percent;
  if (
    Number.isFinite(healthCurrent) &&
    Number.isFinite(healthMax) &&
    healthMax &&
    healthMax > 0
  ) {
    const roundedPercent = Number.isFinite(healthPercent)
      ? Math.max(0, Math.min(100, Math.round(healthPercent)))
      : Math.round((healthCurrent / healthMax) * 100);

    const enemyHpValue = `${Math.round(healthCurrent)} / ${Math.round(healthMax)} (${roundedPercent}%)`;
    const hpField = updatedEmbed.data.fields?.find(
      (field) => field.name === "Enemy HP",
    );
    if (hpField?.value !== enemyHpValue) {
      deps.upsertEmbedField(updatedEmbed, "Enemy HP", enemyHpValue, true);
      hasChanges = true;
    }
  } else if (payload.action === "enemy_health_updated") {
    const hpField = updatedEmbed.data.fields?.find(
      (field) => field.name === "Enemy HP",
    );
    if (hpField?.value !== "Unavailable") {
      deps.upsertEmbedField(updatedEmbed, "Enemy HP", "Unavailable", true);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    await tracked.message.edit({ embeds: [updatedEmbed] });
  }

  await db
    .updateTable(TABLE_NAMES.ASSIST_TOKENS)
    .set({
      last_used_at: new Date().toISOString(),
      last_seen_ip: clientIp,
      last_seen_user_agent: clientUA,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", token.id)
    .execute();

  if (hasChanges) {
    return res.json({ success: true, updated: "message" });
  }

  return res.json({ success: true, updated: "none" });
}

export async function handleAssistDeleteEvent(
  context: SharedEventContext,
  res: Response,
): Promise<Response> {
  const { payload, token, clientIp, clientUA, deps } = context;

  const tracked = deps.getActiveTrackedAssist(payload.uuid);
  if (!tracked) {
    await deps.incrementAssistStrikeByUuid(
      payload.uuid,
      "invalid_delete_without_active_assist",
    );
    return res.status(409).json({
      error:
        "No active assist request exists for this token. Repeated invalid lifecycle updates will deactivate this token.",
    });
  }

  try {
    const endedEmbed = EmbedBuilder.from(tracked.message.embeds[0])
      .setColor(0x6b7280)
      .setFooter({ text: "This assist alert has ended" });
    const endedStatus = deps.resolveStatusFieldValue(payload) || "Fight ended";
    deps.upsertEmbedField(endedEmbed, "Status", endedStatus, true);
    await tracked.message.edit({
      embeds: [endedEmbed],
      components: [],
    });

    setTimeout(async () => {
      try {
        await tracked.message.delete();
        console.log(
          `[ASSIST] Deleted ended assist message for ${payload.uuid}`,
        );
      } catch (error) {
        console.error(
          `[ASSIST] Failed to delete ended assist message for ${payload.uuid}:`,
          error,
        );
      }
    }, 5000);
  } catch (error) {
    console.error(
      `[ASSIST] Failed to mark assist as ended for ${payload.uuid}:`,
      error,
    );
  }

  await db
    .updateTable(TABLE_NAMES.ASSIST_TOKENS)
    .set({
      last_used_at: null,
      last_seen_ip: clientIp,
      last_seen_user_agent: clientUA,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", token.id)
    .execute();

  deps.clearTrackedAssist(payload.uuid);

  return res.json({ success: true, deleted: true, status: "ended" });
}

export async function handleAssistCreateEvent(
  context: SharedEventContext & {
    assistConfig: AssistConfigRow;
    sendMessage: SendAssistMessage;
  },
  res: Response,
): Promise<Response> {
  const {
    payload,
    token,
    assistConfig,
    sendMessage,
    clientIp,
    clientUA,
    deps,
  } = context;

  const activeTracked = deps.getActiveTrackedAssist(payload.uuid);
  if (activeTracked) {
    return res.status(202).json({
      success: true,
      dropped: true,
      reason: "active_assist_exists",
    });
  }

  const mention = assistConfig.ping_role_id
    ? `<@&${assistConfig.ping_role_id}>`
    : "";
  const initialFightStatus =
    deps.resolveStatusFieldValue(payload) || "Requester not started fight";

  const initialAttackerCount = Number.isFinite(payload.attacker_count)
    ? Number(payload.attacker_count)
    : null;
  const initialAttackerValue = Number.isFinite(initialAttackerCount)
    ? String(initialAttackerCount)
    : payload.attacker_count_state === "mobile_unavailable"
      ? "Unavailable (mobile)"
      : "Unavailable";

  const healthCurrent = payload.enemy_health_current;
  const healthMax = payload.enemy_health_max;
  const healthPercent = payload.enemy_health_percent;
  const initialEnemyHpValue =
    Number.isFinite(healthCurrent) &&
    Number.isFinite(healthMax) &&
    healthMax &&
    healthMax > 0
      ? `${Math.round(healthCurrent)} / ${Math.round(healthMax)} (${Math.max(0, Math.min(100, Math.round(Number.isFinite(healthPercent) ? healthPercent : (healthCurrent / healthMax) * 100)))}%)`
      : "Unavailable";

  const embed = deps.buildInitialAssistEmbed(
    payload.target_torn_id,
    token.discord_id,
    initialFightStatus,
    initialAttackerValue,
    initialEnemyHpValue,
  );
  const button = deps.buildAssistButton(payload.target_torn_id);

  const sentMessage = await sendMessage({
    content: mention || undefined,
    embeds: [embed],
    components: button ? [button] : [],
  });

  deps.setTrackedAssist(payload.uuid, {
    message: sentMessage,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    attackerCount: Number.isFinite(initialAttackerCount)
      ? initialAttackerCount
      : null,
  });

  deps.scheduleAssistExpiry(payload.uuid);

  const targetTornId = payload.target_torn_id;
  if (targetTornId) {
    (async () => {
      try {
        const apiKeys = await getGuildApiKeys(token.guild_id);
        if (apiKeys.length === 0) {
          console.warn(
            `[ASSIST] No API keys configured for guild ${token.guild_id}`,
          );
          return;
        }

        const apiKey = getNextApiKey(token.guild_id, apiKeys);
        const enrichedEmbed = EmbedBuilder.from(sentMessage.embeds[0]);
        await deps.enrichAssistEmbed(enrichedEmbed, targetTornId, apiKey);
        await sentMessage.edit({ embeds: [enrichedEmbed] });
      } catch (error) {
        console.error(
          `[ASSIST] Failed to enrich embed for ${payload.uuid}:`,
          error,
        );
      }
    })();
  }

  await db
    .updateTable(TABLE_NAMES.ASSIST_TOKENS)
    .set({
      last_used_at: new Date().toISOString(),
      last_seen_ip: clientIp,
      last_seen_user_agent: clientUA,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", token.id)
    .execute();

  return res.json({
    success: true,
    guildId: token.guild_id,
    channelId: assistConfig.assist_channel_id,
  });
}
