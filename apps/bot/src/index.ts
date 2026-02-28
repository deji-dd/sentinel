import "dotenv/config";
import { Client, Events, EmbedBuilder } from "discord.js";
import { logGuildError } from "./lib/guild-logger.js";
import {
  initializeSupabaseConfig,
  initializeDiscordToken,
  initializeAuthorizedUserId,
  createDiscordClient,
} from "./lib/bot-config.js";
import { logCommandAudit } from "./lib/command-audit.js";
import {
  handleAdminCommand,
  isAdminCommandName,
} from "./lib/admin-commands.js";
import { handleRegularCommand } from "./lib/regular-commands.js";
import { routeInteractionHandler } from "./lib/interaction-handlers.js";
import { handleMemberJoin } from "./lib/auto-verify.js";
import { registerClientReadyEvent } from "./lib/client-events.js";

// Initialize configuration
initializeSupabaseConfig();
const discordToken = initializeDiscordToken();
const authorizedDiscordUserId = initializeAuthorizedUserId();

// Create Discord client
const client = createDiscordClient();

// Register client ready event
registerClientReadyEvent(client);

// Handle all interactions (commands, buttons, modals, selects, etc.)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Handle chat input commands
    if (interaction.isChatInputCommand()) {
      await logCommandAudit(interaction);

      // Try admin commands first
      if (isAdminCommandName(interaction.commandName)) {
        await handleAdminCommand(interaction, authorizedDiscordUserId, client);
      } else {
        // Then try regular commands
        await handleRegularCommand(interaction);
      }
      return;
    }

    // Route other interaction types
    const handled = await routeInteractionHandler(interaction, client);

    if (!handled) {
      console.warn(`Unhandled interaction type or custom ID:`, {
        type: interaction.type,
        customId:
          interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          interaction.isRoleSelectMenu() ||
          interaction.isChannelSelectMenu() ||
          interaction.isModalSubmit()
            ? interaction.customId
            : "N/A",
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected bot error";

    console.error("Bot interaction error:", error);

    if (interaction.guildId) {
      await logGuildError(
        interaction.guildId,
        client,
        "Command Error",
        error instanceof Error ? error : message,
        `Error handling interaction ${interaction.id}.`,
      );
    }

    if (!interaction.isRepliable()) {
      return;
    }

    const errorEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ Error")
      .setDescription(message);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed] });
    }
  }
});

// Handle new member joins - auto-verify if enabled
client.on(Events.GuildMemberAdd, async (member) => {
  await handleMemberJoin(member, client);
});

await client.login(discordToken);
