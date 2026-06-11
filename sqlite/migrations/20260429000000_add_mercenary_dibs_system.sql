-- Migration: add_mercenary_dibs_system
-- Created (UTC): 2026-04-29T00:00:00.000Z

-- Dibs system configuration per guild
CREATE TABLE IF NOT EXISTS sentinel_mercenary_dibs_config (
    guild_id TEXT PRIMARY KEY,
    merc_registration_channel_id TEXT,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    max_active_dibs_per_person INTEGER NOT NULL DEFAULT 5,
    dibs_remaining_minutes INTEGER NOT NULL DEFAULT 15,
    updated_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Registered mercenaries for dibs system
CREATE TABLE IF NOT EXISTS sentinel_mercenary_registered_mercs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    torn_id TEXT,
    torn_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deregistered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guild_id) REFERENCES sentinel_guild_config(guild_id) ON DELETE CASCADE,
    UNIQUE(guild_id, discord_id)
);

-- Active dibs claims per merc per contract
CREATE TABLE IF NOT EXISTS sentinel_mercenary_dibs (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    merc_discord_id TEXT NOT NULL,
    target_torn_id TEXT NOT NULL,
    target_name TEXT NOT NULL,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    completed_at DATETIME,
    status TEXT NOT NULL DEFAULT 'active', -- active, completed, expired, released
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES sentinel_mercenary_contracts(id) ON DELETE CASCADE
);

-- Population events log (for debugging and tracking)
CREATE TABLE IF NOT EXISTS sentinel_mercenary_populations (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    population_type TEXT NOT NULL, -- prewar, during_war
    target_count INTEGER NOT NULL DEFAULT 0,
    eligible_mercs_count INTEGER,
    posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    message_id TEXT,
    channel_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES sentinel_mercenary_contracts(id) ON DELETE CASCADE
);

-- Add columns to mercenary_config for war-state tracking
ALTER TABLE sentinel_mercenary_config ADD COLUMN dibs_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sentinel_mercenary_config ADD COLUMN merc_registration_channel_id TEXT;

-- Add columns to mercenary_contracts for war tracking
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN in_war INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN war_start_at DATETIME;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN war_end_at DATETIME;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN last_population_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_merc_dibs_config_guild ON sentinel_mercenary_dibs_config(guild_id);
CREATE INDEX IF NOT EXISTS idx_merc_registered_mercs_guild ON sentinel_mercenary_registered_mercs(guild_id);
CREATE INDEX IF NOT EXISTS idx_merc_registered_mercs_discord ON sentinel_mercenary_registered_mercs(discord_id);
CREATE INDEX IF NOT EXISTS idx_merc_dibs_contract ON sentinel_mercenary_dibs(contract_id);
CREATE INDEX IF NOT EXISTS idx_merc_dibs_merc ON sentinel_mercenary_dibs(merc_discord_id);
CREATE INDEX IF NOT EXISTS idx_merc_dibs_status ON sentinel_mercenary_dibs(status);
CREATE INDEX IF NOT EXISTS idx_merc_populations_contract ON sentinel_mercenary_populations(contract_id);
CREATE INDEX IF NOT EXISTS idx_merc_populations_guild ON sentinel_mercenary_populations(guild_id);
