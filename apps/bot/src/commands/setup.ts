import {
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  MessageFlags,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const data = {
  name: "setup",
  description: "View Sentinel bot configuration status",
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export async function execute(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
) {
  // In personalized bot mode, setup is just a status check
  // The bot is configured via environment variables
  
  const tornApiKey = process.env.TORN_API_KEY ? "✅ Configured" : "❌ Not configured";
  const discordBot = process.env.DISCORD_BOT_TOKEN ? "✅ Configured" : "❌ Not configured";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL_LOCAL;
  const dbStatus = supabaseUrl ? "✅ Connected" : "❌ Not configured";

  await interaction.reply({
    content:
      `**🤖 Sentinel Configuration Status**\n\n` +
      `🔑 **Torn API Key:** ${tornApiKey}\n` +
      `🤖 **Discord Bot:** ${discordBot}\n` +
      `🗄️ **Database:** ${dbStatus}\n\n` +
      `Sentinel is configured in **personalized bot mode**. All features use the configured API key from environment variables.`,
    // Only use ephemeral flag in servers, not DMs (DMs are already private)
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

// Export modal handler for compatibility with existing bot structure
export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  // No longer needed in personalized bot mode
  // Modal submissions from old setup process are ignored
}
