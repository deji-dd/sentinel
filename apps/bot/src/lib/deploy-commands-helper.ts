import { REST, Routes } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { Logger } from "./logger.js";

const helperLogger = new Logger("DeployCommandsHelper");

function parseEnabledModules(value: string | string[] | null): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

export async function deployGuildCommands(guildId: string): Promise<boolean> {
  try {
    const isDev = process.env.NODE_ENV === "development";
    const token = isDev ? process.env.DISCORD_BOT_TOKEN_LOCAL : process.env.DISCORD_BOT_TOKEN;
    const clientId = isDev ? process.env.DISCORD_CLIENT_ID_LOCAL : process.env.DISCORD_CLIENT_ID;
    const adminGuildId = process.env.ADMIN_GUILD_ID;

    if (!token || !clientId || !adminGuildId) {
      helperLogger.error("Missing credentials for deploying commands");
      return false;
    }

    const rest = new REST({ version: "10" }).setToken(token);

    // Statically/Dynamically load commands
    const verifyCommand = await import("../commands/general/verification/verify.js");
    const verifyallCommand = await import("../commands/general/verification/verifyall.js");
    const configCommand = await import("../commands/general/admin/config.js");
    const assaultCheckCommand = await import("../commands/general/territories/assault-check.js");
    const burnMapCommand = await import("../commands/general/territories/burn-map.js");
    const allianceMapCommand = await import("../commands/general/territories/alliance-map.js");
    const ttSelectorCommand = await import("../commands/general/territories/tt-selector.js");
    const assistCommand = await import("../commands/general/assist/assist.js");
    const adminCommand = await import("../commands/general/admin/admin.js");
    const inviteCommand = await import("../commands/personal/admin/invite.js");

    const commandsByModule: Record<string, any[]> = {
      verify: [verifyCommand.data.toJSON(), verifyallCommand.data.toJSON()],
      admin: [configCommand.data.toJSON()],
      territories: [
        assaultCheckCommand.data.toJSON(),
        burnMapCommand.data.toJSON(),
        allianceMapCommand.data.toJSON(),
        ttSelectorCommand.data.toJSON(),
      ],
      assist: [assistCommand.data.toJSON()],
    };

    if (guildId === adminGuildId) {
      // Admin guild always gets all commands
      const adminCommands = [
        adminCommand.data.toJSON(),
        inviteCommand.data.toJSON(),
        configCommand.data.toJSON(),
        assaultCheckCommand.data.toJSON(),
        burnMapCommand.data.toJSON(),
        allianceMapCommand.data.toJSON(),
        ttSelectorCommand.data.toJSON(),
        verifyCommand.data.toJSON(),
        verifyallCommand.data.toJSON(),
        assistCommand.data.toJSON(),
      ];

      await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
        body: adminCommands,
      });
      helperLogger.info(`Successfully deployed all admin commands to Admin Guild: ${guildId}`);
      return true;
    }

    // Normal guild commands deployment based on DB config
    const guildConfig = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["enabled_modules"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!guildConfig) {
      helperLogger.warn(`No guild config row found for ${guildId}, deploying default config command.`);
      // Default to config command if config not yet saved fully
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [configCommand.data.toJSON()],
      });
      return true;
    }

    const enabledModules = parseEnabledModules(guildConfig.enabled_modules);
    const guildCommands: any[] = [];

    // "admin" module should always be active by default if not set, or we ensure configCommand is available
    if (!enabledModules.includes("admin")) {
      enabledModules.push("admin");
    }

    for (const module of enabledModules) {
      if (commandsByModule[module]) {
        guildCommands.push(...commandsByModule[module]);
      }
    }

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: guildCommands,
    });
    helperLogger.info(`Successfully deployed commands for modules [${enabledModules.join(", ")}] to guild: ${guildId}`);
    return true;
  } catch (error) {
    helperLogger.error(`Failed to deploy commands for guild ${guildId}:`, error);
    return false;
  }
}

export async function deployAllGuildCommands(): Promise<{ success: number; failure: number }> {
  let success = 0;
  let failure = 0;

  try {
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    if (adminGuildId) {
      const ok = await deployGuildCommands(adminGuildId);
      if (ok) success++;
      else failure++;
    }

    const guildConfigs = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["guild_id"])
      .execute();

    for (const config of guildConfigs) {
      if (config.guild_id === adminGuildId) continue;
      const ok = await deployGuildCommands(config.guild_id);
      if (ok) success++;
      else failure++;
    }
  } catch (err) {
    helperLogger.error("Failed executing deployAllGuildCommands:", err);
  }

  return { success, failure };
}
