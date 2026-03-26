-- Migration: update_reaction_role_mappings
-- Created (UTC): 2026-03-26T12:45:43.000Z

ALTER TABLE sentinel_reaction_role_messages ADD COLUMN required_role_id TEXT;
ALTER TABLE sentinel_reaction_role_messages ADD COLUMN sync_roles INTEGER DEFAULT 0;
