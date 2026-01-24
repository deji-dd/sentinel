import type { ChatInputCommandInteraction } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function executeTravel(
  interaction: ChatInputCommandInteraction,
  _supabase: SupabaseClient,
): Promise<void> {
  await interaction.reply({
    content: "Travel command is not implemented yet.",
    ephemeral: true,
  });
}
