/* eslint-disable @typescript-eslint/no-explicit-any */
import { REST, Routes } from "discord.js";
import { GuildConfigs } from "@sentinel/shared";
import { Logger } from "@sentinel/shared";

const helperLogger = new Logger("DeployCommandsHelper");

function parseEnabledModules(value: string | string[] | null): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

export async function deployGuildCommands(guildId: string): Promise<boolean> {
  try {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId =
      process.env.DISCORD_CLIENT_ID || process.env.AUTH_DISCORD_ID;
    const adminGuildId = process.env.ADMIN_GUILD_ID;

    if (!token || !clientId || !adminGuildId) {
      helperLogger.error("Missing credentials for deploying commands");
      return false;
    }

    const rest = new REST({ version: "10" }).setToken(token);

    // Statically/Dynamically load commands
    const configCommand = await import("../commands/general/config.js");
    const verifyCommand =
      await import("../commands/general/verification/verify.js");
    const verifyallCommand =
      await import("../commands/general/verification/verifyall.js");
    const assaultCheckCommand =
      await import("../commands/general/territories/assault-check.js");
    const burnMapCommand =
      await import("../commands/general/territories/burn-map.js");
    const allianceMapCommand =
      await import("../commands/general/territories/alliance-map.js");
    const ttSelectorCommand =
      await import("../commands/general/territories/tt-selector.js");

    const commandsByModule: Record<string, any[]> = {
      verify: [verifyCommand.data.toJSON(), verifyallCommand.data.toJSON()],
      admin: [configCommand.data.toJSON()],
      territories: [
        assaultCheckCommand.data.toJSON(),
        burnMapCommand.data.toJSON(),
        allianceMapCommand.data.toJSON(),
        ttSelectorCommand.data.toJSON(),
      ],
    };

    if (guildId === adminGuildId) {
      // Admin guild always gets all commands
      const adminCommands = [
        configCommand.data.toJSON(),
        assaultCheckCommand.data.toJSON(),
        burnMapCommand.data.toJSON(),
        allianceMapCommand.data.toJSON(),
        ttSelectorCommand.data.toJSON(),
        verifyCommand.data.toJSON(),
        verifyallCommand.data.toJSON(),
      ];

      await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
        body: adminCommands,
      });
      helperLogger.info(
        `Successfully deployed all admin commands to Admin Guild: ${guildId}`,
      );
      return true;
    }

    // Normal guild commands deployment based on DB config
    const guildConfig = GuildConfigs.findOne(guildId);

    if (!guildConfig) {
      helperLogger.warn(
        `No guild config row found for ${guildId}, deploying default config command.`,
      );
      // Default to empty command array if config not yet saved fully
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [],
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
    helperLogger.info(
      `Successfully deployed commands for modules [${enabledModules.join(", ")}] to guild: ${guildId}`,
    );
    return true;
  } catch (error) {
    helperLogger.error(
      `Failed to deploy commands for guild ${guildId}:`,
      error,
    );
    return false;
  }
}

export async function deployAllGuildCommands(): Promise<{
  success: number;
  failure: number;
}> {
  let success = 0;
  let failure = 0;

  try {
    const adminGuildId = process.env.ADMIN_GUILD_ID;
    if (adminGuildId) {
      const ok = await deployGuildCommands(adminGuildId);
      if (ok) success++;
      else failure++;
    }

    const guildConfigs = GuildConfigs.findAll();

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
