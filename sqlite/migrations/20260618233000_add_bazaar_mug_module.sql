-- Migration: add_bazaar_mug_module
-- Created (UTC): 2026-06-18T23:30:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_bazaar_mug_config (
    guild_id TEXT PRIMARY KEY,
    is_enabled INTEGER NOT NULL DEFAULT 0,
    min_bazaar_amount INTEGER NOT NULL DEFAULT 10000000,
    ping_role_id TEXT,
    notification_channel_id TEXT,
    target_player_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bazaar_mug_config_is_enabled ON sentinel_bazaar_mug_config(is_enabled);
