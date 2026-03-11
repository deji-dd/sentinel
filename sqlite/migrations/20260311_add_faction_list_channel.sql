-- Migration: add_faction_list_channel
-- Created (UTC): 2026-03-11T11:15:25.000Z

ALTER TABLE sentinel_guild_config ADD COLUMN faction_list_channel_id TEXT;
ALTER TABLE sentinel_guild_config ADD COLUMN faction_list_message_ids TEXT;
