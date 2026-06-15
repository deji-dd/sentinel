-- Migration: add_mercenary_registration_role
-- Created (UTC): 2026-06-13T11:17:17.000Z

-- Add columns to sentinel_mercenary_config
ALTER TABLE sentinel_mercenary_config ADD COLUMN merc_role_ids_json TEXT DEFAULT '[]';
ALTER TABLE sentinel_mercenary_config ADD COLUMN merc_registration_message_id TEXT DEFAULT NULL;

-- Add column to sentinel_mercenary_registered_mercs
ALTER TABLE sentinel_mercenary_registered_mercs ADD COLUMN api_key TEXT DEFAULT NULL;
