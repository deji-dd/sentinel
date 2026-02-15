import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  RepliableInteraction,
} from "discord.js";

type ReplyOptions = string | InteractionReplyOptions;

export async function safeReply(
  interaction: RepliableInteraction,
  options: ReplyOptions,
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  const payload = typeof options === "string" ? { content: options } : options;

  if (interaction.deferred || interaction.replied) {
    const { flags: _flags, ...editPayload } =
      payload as InteractionReplyOptions & InteractionEditReplyOptions;
    await interaction.editReply(editPayload);
  } else {
    await interaction.reply(payload);
  }
}

export async function runWithInteractionError(
  interaction: RepliableInteraction,
  handler: () => Promise<void>,
  fallbackMessage: string,
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    await safeReply(interaction, `❌ ${message}`);
  }
}
