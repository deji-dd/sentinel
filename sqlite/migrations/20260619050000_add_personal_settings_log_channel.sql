-- Migration: add_personal_settings_log_channel
-- Created (UTC): 2026-06-19T23:04:00.000Z

ALTER TABLE sentinel_personal_settings ADD COLUMN admin_log_channel_id TEXT;
ALTER TABLE sentinel_personal_settings ADD COLUMN error_pings_enabled INTEGER DEFAULT 1;
