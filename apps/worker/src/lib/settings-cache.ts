import { EventEmitter } from "events";
import { watch, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import {
  sentinelDbEngine,
  Collection,
  BaseDocument,
  Logger,
} from "@sentinel/shared";

const logger = new Logger("settings_cache");

/**
 * Defines the structure for the Sentinel owner's personal operational settings.
 */
export interface OwnerSettingsDocument extends BaseDocument {
  user_id: string | null;
  discord_id: string;
  energy_alerts_enabled: number;
  energy_soft_threshold: number;
  energy_aggressive_interval_mins: number;
  last_energy_alert_sent_at: string | null;
  last_energy_alert_type: string | null;
  drug_alerts_enabled: number;
  last_drug_alert_sent_at: string | null;
  crime_alerts_enabled: number;
  crime_soft_threshold: number;
  last_crime_alert_sent_at: string | null;
  last_crime_alert_type: string | null;
  admin_log_channel_id: string | null;
  error_pings_enabled: number;
  selected_build: string;
  target_strength_ratio: number;
  target_defense_ratio: number;
  target_speed_ratio: number;
  target_dexterity_ratio: number;
}

// Instantiate the NoSQL collection for settings.
// The engine will automatically create the `nosql_personal_settings` table if missing.
export const PersonalSettings = new Collection<OwnerSettingsDocument>(
  sentinelDbEngine,
  "personal_settings",
);

export const settingsEmitter = new EventEmitter();

/**
 * Ascends the directory tree to locate the monorepo root.
 */
function findWorkspaceRoot(): string {
  let currentDir = process.cwd();
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return process.cwd();
}

/**
 * Manages an in-memory cache of the bot owner's personal settings.
 * Listens to a local file trigger to hydrate changes without requiring a PM2 restart.
 */
class SettingsCache {
  private cache: OwnerSettingsDocument | null = null;
  public isLoaded = false;
  private triggerFilePath: string;

  constructor() {
    const workspaceRoot = findWorkspaceRoot();
    this.triggerFilePath = join(workspaceRoot, "data", ".settings-trigger");
  }

  /**
   * Hydrates the in-memory cache by reading directly from the NoSQL engine.
   */
  async hydrate(): Promise<void> {
    try {
      const ownerDiscordId = process.env.SENTINEL_DISCORD_USER_ID;
      if (!ownerDiscordId) {
        logger.warn(
          "SENTINEL_DISCORD_USER_ID is not configured in environment.",
        );
        return;
      }

      // High-speed RAM filter via NoSQL wrapper
      const settings = PersonalSettings.findFirst(
        (doc) => doc.discord_id === ownerDiscordId,
      );

      if (settings) {
        this.cache = settings;
        this.isLoaded = true;
        logger.info("Successfully hydrated personal settings from NoSQL.");
      } else {
        logger.warn(
          `No personal settings found in NoSQL for owner: ${ownerDiscordId}`,
        );
      }
    } catch (error) {
      logger.error("Failed to hydrate cache:", error);
    }
  }

  /**
   * Retrieves the active settings cache.
   */
  get(): OwnerSettingsDocument | null {
    return this.cache;
  }

  /**
   * Updates specific alert states in RAM.
   * (Note: This does not persist to DB automatically. The worker should trigger a DB update separately).
   */
  updateAlertState(updates: Partial<OwnerSettingsDocument>): void {
    if (this.cache) {
      this.cache = {
        ...this.cache,
        ...updates,
      };
    }
  }

  /**
   * Initializes a filesystem watcher on the trigger file.
   * Emits a reload event when external processes touch the file.
   */
  startWatching(): void {
    const dataDir = dirname(this.triggerFilePath);
    if (!existsSync(dataDir)) {
      logger.warn(`Data directory missing: ${dataDir}. Skipping watcher.`);
      return;
    }

    if (!existsSync(this.triggerFilePath)) {
      try {
        writeFileSync(this.triggerFilePath, "", "utf-8");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        logger.warn(`Could not create trigger file: ${this.triggerFilePath}`);
      }
    }

    try {
      watch(this.triggerFilePath, async (event) => {
        if (event === "change") {
          logger.info(
            "Settings change detected via file! Re-hydrating cache...",
          );
          settingsEmitter.emit("settings-changed");
        }
      });
    } catch (err) {
      logger.warn("Failed to start file watcher:", err);
    }

    settingsEmitter.on("settings-changed", async () => {
      await this.hydrate();
    });
  }
}

export const settingsCache = new SettingsCache();
