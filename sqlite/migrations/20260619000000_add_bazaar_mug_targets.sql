-- Migration: add_bazaar_mug_targets
-- Created (UTC): 2026-06-19T00:00:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_bazaar_mug_targets (
    guild_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (guild_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_bazaar_mug_targets_guild ON sentinel_bazaar_mug_targets(guild_id);
