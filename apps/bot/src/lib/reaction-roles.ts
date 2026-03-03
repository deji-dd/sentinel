/**
 * Reaction Role Message Handler
 * Processes emoji reactions on messages to assign roles
 */

import {
  type MessageReaction,
  type User,
  type PartialMessageReaction,
  type PartialUser,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "./supabase.js";

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

    // Find the role mapping for this emoji+message combo
    const { data: mapping } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .select("role_id")
      .eq("message_id", messageId)
      .eq("emoji", emoji)
      .single();

    if (!mapping) {
      // No mapping found - remove the reaction
      await fullReaction.remove().catch(() => {
        // Reaction might already be removed
      });
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
        // User doesn't have permission - remove reaction
        await fullReaction.remove().catch(() => {
          // Reaction might already be removed
        });
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
      } else {
        // User doesn't have the role - add it
        await member.roles.add(roleId, `Reaction role assignment: ${emoji}`);
      }
    } catch (error) {
      console.error("Failed to toggle reaction role:", error);
      // Try to remove the reaction to indicate failure
      await fullReaction.remove().catch(() => {
        // Reaction might already be removed
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error handling reaction role add:", errorMsg);
  }
}

/**
 * Handle emoji reaction removal for role unassignment
 */
export async function handleReactionRoleRemove(
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

    const messageId = fullReaction.message.id;
    const emoji = fullReaction.emoji.toString();

    // Find the role mapping for this emoji+message combo
    const { data: mapping } = await supabase
      .from(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
      .select("role_id")
      .eq("message_id", messageId)
      .eq("emoji", emoji)
      .single();

    if (!mapping) {
      return;
    }

    // Get the guild member
    const member = await fullReaction.message.guild?.members.fetch(user.id);
    if (!member) return;

    // Remove the role
    const roleId = mapping.role_id;
    try {
      await member.roles.remove(roleId, `Reaction role removal: ${emoji}`);
    } catch (error) {
      console.error("Failed to remove reaction role:", error);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error handling reaction role remove:", errorMsg);
  }
}
