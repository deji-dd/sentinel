-- Migration: add_guild_id_to_mercenary_dibs
-- Created (UTC): 2026-06-13T21:20:32.326Z

ALTER TABLE sentinel_mercenary_dibs ADD COLUMN guild_id TEXT;
CREATE INDEX IF NOT EXISTS idx_merc_dibs_guild ON sentinel_mercenary_dibs(guild_id);
