import { EventEmitter } from "events";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { watch, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const settingsEmitter = new EventEmitter();

export interface CachedSettings {
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

function findWorkspaceRoot(): string {
  let currentDir = __dirname;
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return process.cwd();
}

class SettingsCache {
  private cache: CachedSettings | null = null;
  private isLoaded = false;
  private triggerFilePath: string;

  constructor() {
    const workspaceRoot = findWorkspaceRoot();
    this.triggerFilePath = join(workspaceRoot, "data", ".settings-trigger");
  }

  async hydrate(): Promise<void> {
    try {
      const db = getKysely();
      const ownerDiscordId = process.env.SENTINEL_DISCORD_USER_ID;
      if (!ownerDiscordId) {
        console.warn("[SettingsCache] Warning: SENTINEL_DISCORD_USER_ID is not configured in worker process env");
        return;
      }

      const settings = await db
        .selectFrom(TABLE_NAMES.PERSONAL_SETTINGS)
        .selectAll()
        .where("discord_id", "=", ownerDiscordId)
        .executeTakeFirst();

      if (settings) {
        this.cache = {
          user_id: settings.user_id,
          discord_id: settings.discord_id,
          energy_alerts_enabled: Number(settings.energy_alerts_enabled ?? 0),
          energy_soft_threshold: Number(settings.energy_soft_threshold ?? 130),
          energy_aggressive_interval_mins: Number(settings.energy_aggressive_interval_mins ?? 5),
          last_energy_alert_sent_at: settings.last_energy_alert_sent_at,
          last_energy_alert_type: settings.last_energy_alert_type,
          drug_alerts_enabled: Number(settings.drug_alerts_enabled ?? 0),
          last_drug_alert_sent_at: settings.last_drug_alert_sent_at,
          crime_alerts_enabled: Number(settings.crime_alerts_enabled ?? 0),
          crime_soft_threshold: Number(settings.crime_soft_threshold ?? 15),
          last_crime_alert_sent_at: settings.last_crime_alert_sent_at,
          last_crime_alert_type: settings.last_crime_alert_type,
          admin_log_channel_id: settings.admin_log_channel_id,
          error_pings_enabled: Number(settings.error_pings_enabled ?? 1),
          selected_build: settings.selected_build || "balanced",
          target_strength_ratio: Number(settings.target_strength_ratio ?? 25.0),
          target_defense_ratio: Number(settings.target_defense_ratio ?? 25.0),
          target_speed_ratio: Number(settings.target_speed_ratio ?? 25.0),
          target_dexterity_ratio: Number(settings.target_dexterity_ratio ?? 25.0),
        };
        this.isLoaded = true;
        console.log("[SettingsCache] ✓ Successfully hydrated personal settings from database");
      } else {
        console.warn("[SettingsCache] No personal settings found in DB for owner:", ownerDiscordId);
      }
    } catch (error) {
      console.error("[SettingsCache] Failed to hydrate cache from database:", error);
    }
  }

  get(): CachedSettings | null {
    return this.cache;
  }

  updateAlertState(updates: Partial<Pick<CachedSettings, 'last_energy_alert_type' | 'last_energy_alert_sent_at' | 'last_crime_alert_type' | 'last_crime_alert_sent_at' | 'last_drug_alert_sent_at'>>): void {
    if (this.cache) {
      this.cache = {
        ...this.cache,
        ...updates
      };
    }
  }

  startWatching(): void {
    const dataDir = dirname(this.triggerFilePath);
    if (!existsSync(dataDir)) {
      console.warn(`[SettingsCache] Data directory does not exist: ${dataDir}. Skipping trigger file watching.`);
      return;
    }

    if (!existsSync(this.triggerFilePath)) {
      try {
        writeFileSync(this.triggerFilePath, "", "utf-8");
      } catch (err) {
        console.warn(`[SettingsCache] Could not create trigger file: ${this.triggerFilePath}`);
      }
    }

    try {
      watch(this.triggerFilePath, async (event) => {
        if (event === "change") {
          console.log("[SettingsCache] Settings change detected! Re-hydrating cache...");
          settingsEmitter.emit("settings-changed");
        }
      });
    } catch (err) {
      console.warn("[SettingsCache] Failed to start file watcher on settings trigger:", err);
    }

    settingsEmitter.on("settings-changed", async () => {
      await this.hydrate();
    });
  }
}

export const settingsCache = new SettingsCache();
