-- Add missing columns to sentinel_web_sessions if they don't exist
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS easily without separate statements

ALTER TABLE sentinel_web_sessions ADD COLUMN guild_id TEXT;
ALTER TABLE sentinel_web_sessions ADD COLUMN target_path TEXT;
