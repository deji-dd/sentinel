/**
 * Reaction Role Message Handler
 * Processes emoji reactions on messages to assign roles
 */

import {
  EmbedBuilder,
  type MessageReaction,
  type User,
  type PartialMessageReaction,
  type PartialUser,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "./supabase.js";

const REACTION_FEEDBACK_TTL_MS = 10000;
const REACTION_EVENT_LOCK_MS = 4000;
const reactionProcessingLock = new Map<string, number>();

type ReactionFeedbackType =
  | "added"
  | "removed"
  | "denied"
  | "invalid"
  | "error";

function normalizeEmojiForKey(emoji: string): string {
  return emoji.normalize("NFKC").replace(/\uFE0F/g, "");
}

function getReactionKey(
  messageId: string,
  userId: string,
  emoji: string,
): string {
  return `${messageId}:${userId}:${normalizeEmojiForKey(emoji)}`;
}

function beginReactionProcessing(key: string): boolean {
  const now = Date.now();
  const existing = reactionProcessingLock.get(key);

  if (existing && now - existing < REACTION_EVENT_LOCK_MS) {
    return false;
  }

  reactionProcessingLock.set(key, now);

  setTimeout(() => {
    const current = reactionProcessingLock.get(key);
    if (current === now) {
      reactionProcessingLock.delete(key);
    }
  }, REACTION_EVENT_LOCK_MS * 2);

  return true;
}

async function sendReactionLogEmbed(
  channelContext: unknown,
  guildId: string,
  actorUserId: string,
  sourceChannelId: string,
  title: string,
  description: string,
): Promise<void> {
  try {
    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("log_channel_id")
      .eq("guild_id", guildId)
      .maybeSingle();

    const logChannelId = guildConfig?.log_channel_id;
    if (!logChannelId) return;
    if (logChannelId === sourceChannelId) return;

    if (
      !channelContext ||
      typeof channelContext !== "object" ||
      !("client" in channelContext)
    ) {
      return;
    }

    const maybeClient = (channelContext as { client?: unknown }).client;
    if (
      !maybeClient ||
      typeof maybeClient !== "object" ||
      !("channels" in maybeClient)
    ) {
      return;
    }

    const channels = (
      maybeClient as {
        channels?: { fetch?: (id: string) => Promise<unknown> };
      }
    ).channels;
    if (!channels?.fetch) {
      return;
    }

    const logChannel = await channels.fetch(logChannelId);

    if (
      !logChannel ||
      typeof logChannel !== "object" ||
      !("isTextBased" in logChannel) ||
      typeof (logChannel as { isTextBased?: unknown }).isTextBased !==
        "function" ||
      !("isDMBased" in logChannel) ||
      typeof (logChannel as { isDMBased?: unknown }).isDMBased !== "function" ||
      !("send" in logChannel) ||
      typeof (logChannel as { send?: unknown }).send !== "function"
    ) {
      return;
    }

    const typedLogChannel = logChannel as {
      isTextBased: () => boolean;
      isDMBased: () => boolean;
      send: (payload: { embeds: EmbedBuilder[] }) => Promise<unknown>;
    };

    if (!typedLogChannel.isTextBased() || typedLogChannel.isDMBased()) {
      return;
    }

    const logEmbed = new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle(title)
      .setDescription(description)
      .addFields(
        { name: "User", value: `<@${actorUserId}>`, inline: true },
        {
          name: "Source Channel",
          value: `<#${sourceChannelId}>`,
          inline: true,
        },
      )
      .setTimestamp();

    await typedLogChannel.send({ embeds: [logEmbed] });
  } catch (error) {
    console.warn("Failed to send reaction log embed:", error);
  }
}

async function sendReactionFeedback(
  channel: unknown,
  guildId: string,
  sourceChannelId: string,
  _messageId: string,
  _emoji: string,
  userId: string,
  feedbackType: ReactionFeedbackType,
  title: string,
  description: string,
): Promise<void> {
  try {
    if (
      !channel ||
      typeof channel !== "object" ||
      !("send" in channel) ||
      typeof (channel as { send?: unknown }).send !== "function"
    ) {
      return;
    }

    const feedbackEmbed = new EmbedBuilder()
      .setColor(
        feedbackType === "added"
          ? 0x22c55e
          : feedbackType === "removed"
            ? 0xf59e0b
            : feedbackType === "error"
              ? 0xef4444
              : 0x3b82f6,
      )
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: "This message auto-deletes in 10 seconds" });

    const feedbackMessage = await (
      channel as {
        send: (payload: {
          content: string;
          embeds: EmbedBuilder[];
          allowedMentions: { users: string[] };
        }) => Promise<{ delete: () => Promise<unknown> }>;
      }
    ).send({
      content: `<@${userId}>`,
      embeds: [feedbackEmbed],
      allowedMentions: { users: [userId] },
    });

    if (feedbackType === "added" || feedbackType === "removed") {
      await sendReactionLogEmbed(
        channel,
        guildId,
        userId,
        sourceChannelId,
        title,
        description,
      );
    }

    setTimeout(() => {
      void feedbackMessage.delete().catch(() => {
        // Message may already be deleted or inaccessible
      });
    }, REACTION_FEEDBACK_TTL_MS);
  } catch (error) {
    console.warn("Failed to send reaction feedback message:", error);
  }
}

/**
 * Handle emoji reactions for role assignment
 */
export async function handleReactionRoleAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    // Ignore bot reactions
    if (user.bot) return;

    // Ensure reaction is fully fetched
    const fullReaction = reaction.partial ? await reaction.fetch() : reaction;

    // Check if reaction is in a guild
    if (!fullReaction.message.guildId) return;

    const guildId = fullReaction.message.guildId;
    const messageId = fullReaction.message.id;
    const emoji = fullReaction.emoji.toString();
    const reactionKey = getReactionKey(messageId, user.id, emoji);

    if (!beginReactionProcessing(reactionKey)) {
      return;
    }

    const feedbackChannel = fullReaction.message.channel;
    const sourceChannelId = fullReaction.message.channelId;

    // Find the role mapping for this emoji+message combo
    const { data: mapping } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .select("role_id")
      .eq("message_id", messageId)
      .eq("emoji", emoji)
      .single();

    const removeUserReaction = async () => {
      await fullReaction.users.remove(user.id).catch(() => {
        // Reaction may already be gone or inaccessible
      });
    };

    if (!mapping) {
      await removeUserReaction();
      await sendReactionFeedback(
        feedbackChannel,
        guildId,
        sourceChannelId,
        messageId,
        emoji,
        user.id,
        "invalid",
        "Reaction Role Not Configured",
        "That emoji is not configured for this reaction-role message.",
      );
      return;
    }

    // Get the guild member
    const member = await fullReaction.message.guild?.members.fetch(user.id);
    if (!member) return;

    // Check if user is allowed to use reaction roles
    const { data: config } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_CONFIG)
      .select("allowed_role_ids")
      .eq("guild_id", guildId)
      .single();

    const allowedRoleIds = config?.allowed_role_ids || [];

    // If allowed roles are configured, check if user has one
    if (allowedRoleIds.length > 0) {
      const hasAllowedRole = member.roles.cache.some((role) =>
        allowedRoleIds.includes(role.id),
      );

      if (!hasAllowedRole) {
        await removeUserReaction();
        await sendReactionFeedback(
          feedbackChannel,
          guildId,
          sourceChannelId,
          messageId,
          emoji,
          user.id,
          "denied",
          "Reaction Role Access Denied",
          "You are not allowed to use reaction roles in this server.",
        );
        return;
      }
    }

    // Toggle the role - add if user doesn't have it, remove if they do
    const roleId = mapping.role_id;
    const hasRole = member.roles.cache.has(roleId);

    try {
      if (hasRole) {
        // User already has the role - remove it
        await member.roles.remove(roleId, `Reaction role removal: ${emoji}`);
        await sendReactionFeedback(
          feedbackChannel,
          guildId,
          sourceChannelId,
          messageId,
          emoji,
          user.id,
          "removed",
          "Reaction Role Removed",
          `Removed <@&${roleId}>.`,
        );
      } else {
        // User doesn't have the role - add it
        await member.roles.add(roleId, `Reaction role assignment: ${emoji}`);
        await sendReactionFeedback(
          feedbackChannel,
          guildId,
          sourceChannelId,
          messageId,
          emoji,
          user.id,
          "added",
          "Reaction Role Added",
          `Added <@&${roleId}>.`,
        );
      }

      await removeUserReaction();
    } catch (error) {
      console.error("Failed to toggle reaction role:", error);
      await removeUserReaction();
      await sendReactionFeedback(
        feedbackChannel,
        guildId,
        sourceChannelId,
        messageId,
        emoji,
        user.id,
        "error",
        "Reaction Role Update Failed",
        "I couldn't update your role. Please try again or contact an admin.",
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error handling reaction role add:", errorMsg);
  } finally {
    // Lock cleanup is time-based in beginReactionProcessing to absorb duplicate dispatches.
  }
}

/**
 * Handle emoji reaction removal for role unassignment
 */
export async function handleReactionRoleRemove(
  _reaction: MessageReaction | PartialMessageReaction,
  _user: User | PartialUser,
): Promise<void> {
  return;
}
