import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Interaction,
} from "discord.js";
import dotenv from "dotenv";
import { logger } from "./lib/logger.js";
import { buildCommandsCollection } from "./commands/index.js";
import { readyEvent } from "./events/ready.js";
import { interactionCreateEvent } from "./events/interactionCreate.js";
import { guildMemberAddEvent } from "./events/guildMemberAdd.js";
import { deployCommands } from "./deploy-commands.js";

import { addIpcMessageListener } from "./lib/ipc-client.js";
import { handleTerritoryAlert } from "./lib/territory-alert-distributor.js";
import { handleReactionRoleAdd, syncReactionRoleMessages } from "./lib/reaction-roles.js";
import { updateFactionMapChannel } from "./lib/faction-map-channel.js";

dotenv.config();

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    logger.warn(
      "No DISCORD_TOKEN found in environment variables. Discord bot is idle.",
    );
    return;
  }

  // Auto-deploy commands in production or if AUTO_DEPLOY_COMMANDS is explicitly enabled
  const shouldAutoDeploy =
    process.env.NODE_ENV === "production" ||
    process.env.AUTO_DEPLOY_COMMANDS === "true";

  if (shouldAutoDeploy) {
    logger.info("Auto-deploying slash commands on bot startup...");
    await deployCommands();
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
  });

  const commands = buildCommandsCollection();

  client.once(Events.ClientReady, (readyClient) =>
    readyEvent.execute(readyClient),
  );
  client.on(Events.InteractionCreate, (interaction: Interaction) =>
    interactionCreateEvent.execute(interaction, commands),
  );
  client.on(Events.GuildMemberAdd, (member) =>
    guildMemberAddEvent.execute(member),
  );
  client.on(Events.MessageReactionAdd, (reaction, user) =>
    handleReactionRoleAdd(reaction, user),
  );

  // Register IPC event listeners for real-time dashboard updates
  addIpcMessageListener((message: any) => {
    if (!message?.action) return;

    if (message.action === "sync_reaction_roles") {
      void syncReactionRoleMessages(client, message.data?.guildId);
    } else if (message.action === "sync_faction_map") {
      void updateFactionMapChannel(client, message.data?.guildId);
    } else if (message?.data) {
      handleTerritoryAlert(client, message.action, message.data);
    }
  });


  try {
    logger.info("Connecting Discord Bot V2 client...");
    await client.login(token);
  } catch (error) {
    logger.error("Failed to connect Discord Bot V2:", error);
  }
}

main();
