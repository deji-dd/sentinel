-- Migration: add_personal_settings
-- Created (UTC): 2026-06-19T22:35:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_personal_settings (
  user_id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  energy_alerts_enabled INTEGER DEFAULT 0,
  energy_soft_threshold INTEGER DEFAULT 130,
  energy_aggressive_interval_mins INTEGER DEFAULT 5,
  last_energy_alert_sent_at TEXT,
  last_energy_alert_type TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
