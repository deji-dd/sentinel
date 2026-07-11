import "dotenv/config";
import { Events, EmbedBuilder, DiscordAPIError } from "discord.js";
import { logGuildError } from "./lib/guild-logger.js";
import {
  initializeDatabaseConfig,
  initializeDiscordToken,
  initializeAuthorizedUserId,
  createDiscordClient,
} from "./lib/bot-config.js";
import {
  handleAdminCommand,
  isAdminCommandName,
} from "./lib/admin-commands.js";
import { handleRegularCommand } from "./lib/regular-commands.js";
import { routeInteractionHandler } from "./lib/interaction-handlers.js";
import * as guildMemberAddEvent from "./events/guildMemberAdd.js";
import { registerClientReadyEvent } from "./lib/client-events.js";
import {
  handleReactionRoleAdd,
  handleReactionRoleRemove,
} from "./lib/reaction-roles.js";

import { setGlobalClient } from "./lib/global-client.js";
import { setupIpcServer } from "./lib/ipc-listener.js";
import { startMetricsReporter, stopMetricsReporter } from "@sentinel/shared";

// Global process error handlers to prevent crashes on transient network socket drops
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("other side closed") ||
    msg.includes("UND_ERR_SOCKET") ||
    msg.includes("ECONNRESET") ||
    msg.includes("socket hang up")
  ) {
    console.warn(
      "[Process] Gracefully caught transient network socket error:",
      msg,
    );
  } else {
    console.error("[Process] Uncaught Exception:", err);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "[Process] Unhandled Rejection at:",
    promise,
    "reason:",
    reason,
  );
});

// Initialize configuration
initializeDatabaseConfig();
const discordToken = initializeDiscordToken();
const authorizedDiscordUserId = initializeAuthorizedUserId();

// Create Discord client
const client = createDiscordClient();
setGlobalClient(client);

// Register client ready event
registerClientReadyEvent(client);

startMetricsReporter("bot");

// IPC server is started in client-events.js after client is ready

// Handle all interactions (commands, buttons, modals, selects, etc.)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Handle chat input commands
    if (interaction.isChatInputCommand()) {
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

    // Gracefully handle expired/unknown interaction errors (10062)
    // These occur when handlers take too long and Discord expires the interaction token
    if (error instanceof DiscordAPIError && error.code === 10062) {
      console.warn(
        `[Interaction] Unknown interaction ${interaction.id} - likely expired. This is expected for slow operations.`,
      );
      return;
    }

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
      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {
        // Silently ignore if we can't even edit (e.g., interaction expired)
      });
    } else {
      await interaction.reply({ embeds: [errorEmbed] }).catch(() => {
        // Silently ignore if we can't reply (e.g., interaction expired)
      });
    }
  }
});

// Handle new member joins - auto-verify if enabled
client.on(guildMemberAddEvent.name, async (...args) => {
  try {
    await guildMemberAddEvent.execute(...args);
  } catch (error) {
    console.error(`Error executing ${guildMemberAddEvent.name} event:`, error);
  }
});

// Handle message reactions for role assignment
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionRoleAdd(reaction, user);
  } catch (error) {
    console.error("Error handling message reaction add:", error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReactionRoleRemove(reaction, user);
  } catch (error) {
    console.error("Error handling message reaction remove:", error);
  }
});

await client.login(discordToken);

const shutdown = () => {
  console.log("Shutting down bot...");
  stopMetricsReporter("bot");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
