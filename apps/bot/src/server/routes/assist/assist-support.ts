import { type Request } from "express";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Message,
} from "discord.js";

export type AssistPayload = {
  uuid: string;
  auth_token?: string;
  client_sent_at?: string;
  action?: string;
  source?: string;
  attacker_name?: string;
  attacker_torn_id?: number;
  target_name?: string;
  target_torn_id?: number;
  result?: string;
  details?: string;
  occurred_at?: string;
  fight_status?: string;
  attacker_count?: number;
  attacker_count_state?: string;
  enemy_health_current?: number;
  enemy_health_max?: number;
  enemy_health_percent?: number;
};

export type TrackedAssist = {
  message: Message;
  createdAt: number;
  lastActivityAt: number;
  attackerCount: number | null;
};

export function normalizeFightStatus(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "target is down") {
    return "Target is down";
  }

  if (normalized === "requester is down") {
    return "Requester is down";
  }

  if (normalized === "requester stalemated") {
    return "Requester stalemated";
  }

  if (normalized === "requester timed out") {
    return "Requester timed out";
  }

  if (normalized === "fight ended") {
    return "Fight ended";
  }

  if (normalized === "not started" || normalized === "not_started") {
    return "Requester not started fight";
  }

  if (normalized === "ongoing" || normalized === "started") {
    return "Ongoing";
  }

  if (normalized === "ended" || normalized === "finished") {
    return "Fight ended";
  }

  return null;
}

export function normalizeFightOutcomeStatus(
  value: string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const lower = compact.toLowerCase();

  if (
    lower.includes("target is down") ||
    lower.includes("you defeated") ||
    lower.includes("you mugged") ||
    lower.includes("you hospitalized") ||
    lower.includes("you arrested")
  ) {
    return "Target is down";
  }

  if (
    lower.includes("requester stalemated") ||
    lower.includes("you stalemated")
  ) {
    return "Requester stalemated";
  }

  if (lower.includes("requester is down") || lower.includes("you lost")) {
    return "Requester is down";
  }

  if (lower.includes("requester timed out") || lower.includes("timed out")) {
    return "Requester timed out";
  }

  if (
    lower.includes("took down your opponent") ||
    lower.includes("was defeated by")
  ) {
    return "Target is down";
  }

  if (
    lower.includes("was sent to hospital") ||
    lower.includes("was surrounded by police")
  ) {
    return "Target is down";
  }

  return null;
}

export function resolveStatusFieldValue(payload: AssistPayload): string | null {
  const outcomeStatus = normalizeFightOutcomeStatus(payload.fight_status);
  if (outcomeStatus) {
    return outcomeStatus;
  }

  return normalizeFightStatus(payload.fight_status);
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function getClientIp(req: Request): string {
  let ip =
    req.header("CF-Connecting-IP") || req.header("X-Forwarded-For") || req.ip;
  if (ip && ip.includes(",")) {
    ip = ip.split(",")[0].trim();
  }
  return ip || "unknown";
}

export function getAssistPayloadSizeBytes(req: Request): number {
  const fromHeader = Number.parseInt(req.header("content-length") || "0", 10);
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return fromHeader;
  }

  return Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
}

export function buildInitialAssistEmbed(
  targetTornId: number | undefined,
  requesterDiscordId: string,
  fightStatus: string,
  initialAttackerValue: string,
  initialEnemyHpValue: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("Assist Alert")
    .addFields(
      { name: "Source", value: "Userscript", inline: true },
      { name: "Requester", value: `<@${requesterDiscordId}>`, inline: true },
      { name: "Status", value: fightStatus, inline: true },
      {
        name: "Target",
        value: targetTornId ? "Loading..." : "Unknown",
        inline: true,
      },
      { name: "Attackers", value: initialAttackerValue, inline: true },
      { name: "Enemy HP", value: initialEnemyHpValue, inline: true },
    )
    .setTimestamp();
}

export function upsertEmbedField(
  embed: EmbedBuilder,
  name: string,
  value: string,
  inline: boolean,
): void {
  const fields = embed.data.fields || [];
  const index = fields.findIndex((field) => field.name === name);

  if (index >= 0) {
    embed.spliceFields(index, 1, { name, value, inline });
    return;
  }

  embed.addFields({ name, value, inline });
}

export function buildAssistButton(
  targetTornId: number | undefined,
): ActionRowBuilder<ButtonBuilder> | null {
  if (!targetTornId) {
    return null;
  }

  const assistButton = new ButtonBuilder()
    .setLabel("Assist")
    .setStyle(ButtonStyle.Link)
    .setURL(
      `https://www.torn.com/loader.php?sid=attack&user2ID=${targetTornId}`,
    );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(assistButton);
}

export function createAssistTrackingStore(timeoutMs: number): {
  getActiveTrackedAssist: (uuid: string) => TrackedAssist | null;
  setTrackedAssist: (uuid: string, tracked: TrackedAssist) => void;
  clearTrackedAssist: (uuid: string) => void;
  scheduleAssistExpiry: (uuid: string) => void;
} {
  const tracking = new Map<string, TrackedAssist>();

  const getActiveTrackedAssist = (uuid: string): TrackedAssist | null => {
    const tracked = tracking.get(uuid);
    if (!tracked) {
      return null;
    }

    if (Date.now() - tracked.lastActivityAt > timeoutMs) {
      tracking.delete(uuid);
      return null;
    }

    return tracked;
  };

  const setTrackedAssist = (uuid: string, tracked: TrackedAssist): void => {
    tracking.set(uuid, tracked);
  };

  const clearTrackedAssist = (uuid: string): void => {
    tracking.delete(uuid);
  };

  const scheduleAssistExpiry = (uuid: string): void => {
    const tracked = tracking.get(uuid);
    if (!tracked) {
      return;
    }

    const idleMs = Date.now() - tracked.lastActivityAt;
    const remainingMs = Math.max(1, timeoutMs - idleMs);

    setTimeout(async () => {
      const current = tracking.get(uuid);
      if (!current) {
        return;
      }

      const currentIdleMs = Date.now() - current.lastActivityAt;
      if (currentIdleMs < timeoutMs) {
        scheduleAssistExpiry(uuid);
        return;
      }

      try {
        const expiredEmbed = EmbedBuilder.from(current.message.embeds[0])
          .setColor(0x6b7280)
          .setFooter({ text: "This assist alert has expired" });
        upsertEmbedField(expiredEmbed, "Status", "Ended (Expired)", true);
        await current.message.edit({
          embeds: [expiredEmbed],
          components: [],
        });

        setTimeout(async () => {
          try {
            await current.message.delete();
            console.log(`[ASSIST] Deleted expired assist message for ${uuid}`);
          } catch (error) {
            console.error(
              `[ASSIST] Failed to delete expired assist message for ${uuid}:`,
              error,
            );
          }
        }, 5000);
      } catch (error) {
        console.error(`[ASSIST] Failed to expire embed for ${uuid}:`, error);
      }

      tracking.delete(uuid);
    }, remainingMs);
  };

  return {
    getActiveTrackedAssist,
    setTrackedAssist,
    clearTrackedAssist,
    scheduleAssistExpiry,
  };
}
