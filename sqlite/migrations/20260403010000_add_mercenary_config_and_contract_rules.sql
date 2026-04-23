-- Migration: add_mercenary_config_and_contract_rules
-- Created (UTC): 2026-04-03T01:00:00.000Z

CREATE TABLE IF NOT EXISTS sentinel_mercenary_config (
    guild_id TEXT PRIMARY KEY,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    contract_announcement_channel_id TEXT,
    hit_post_channel_id TEXT,
    payout_channel_id TEXT,
    audit_channel_id TEXT,
    default_target_scope TEXT NOT NULL DEFAULT 'all_members',
    default_idle_minutes INTEGER,
    default_auto_finish_on_war_end INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sentinel_mercenary_contracts ADD COLUMN guild_id TEXT;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN faction_id INTEGER;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN faction_name TEXT;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN target_scope TEXT NOT NULL DEFAULT 'all_members';
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN idle_minutes INTEGER;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN auto_finish_on_war_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN min_level INTEGER;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN max_level INTEGER;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN target_roles_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN require_faction_no_active_war INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentinel_mercenary_contracts ADD COLUMN require_faction_no_upcoming_war INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_merc_config_is_enabled ON sentinel_mercenary_config(is_enabled);
CREATE INDEX IF NOT EXISTS idx_merc_contracts_guild_id ON sentinel_mercenary_contracts(guild_id);
CREATE INDEX IF NOT EXISTS idx_merc_contracts_faction_id ON sentinel_mercenary_contracts(faction_id);
CREATE INDEX IF NOT EXISTS idx_merc_contracts_target_scope ON sentinel_mercenary_contracts(target_scope);