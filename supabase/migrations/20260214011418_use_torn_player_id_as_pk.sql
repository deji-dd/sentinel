-- Migration: Use Torn player_id as primary key for personalized single-user app
--
-- Simplify schema for personalized mode by using player_id (Torn ID) as the primary key
-- instead of auto-incrementing id with CHECK constraints. This is simpler and more
-- semantically correct - we have one Torn user per app instance with a stable ID.
--
-- Changes:
-- 1. Remove the id SERIAL column and id-based constraints
-- 2. Use player_id as PRIMARY KEY for data tables
-- 3. Delete existing data (fresh start with new schema)

-- sentinel_user_data: Use player_id as primary key
ALTER TABLE sentinel_user_data DROP CONSTRAINT sentinel_user_data_pkey;
ALTER TABLE sentinel_user_data DROP CONSTRAINT IF EXISTS sentinel_user_data_single_row;
ALTER TABLE sentinel_user_data DROP COLUMN IF EXISTS id;
ALTER TABLE sentinel_user_data ADD PRIMARY KEY (player_id);
DELETE FROM sentinel_user_data;
COMMENT ON TABLE sentinel_user_data IS 'Single Torn user profile data. Keyed by player_id.';

-- sentinel_user_bars: Use player_id as primary key
ALTER TABLE sentinel_user_bars DROP CONSTRAINT sentinel_user_bars_pkey;
ALTER TABLE sentinel_user_bars DROP CONSTRAINT IF EXISTS sentinel_user_bars_single_row;
ALTER TABLE sentinel_user_bars DROP COLUMN IF EXISTS id;
-- Add player_id column if it doesn't exist
ALTER TABLE sentinel_user_bars ADD COLUMN IF NOT EXISTS player_id BIGINT;
ALTER TABLE sentinel_user_bars ALTER COLUMN player_id SET NOT NULL;
ALTER TABLE sentinel_user_bars ADD PRIMARY KEY (player_id);
DELETE FROM sentinel_user_bars;
COMMENT ON TABLE sentinel_user_bars IS 'Single Torn user bars (energy, nerve, etc). Keyed by player_id.';

-- sentinel_user_cooldowns: Use player_id as primary key
ALTER TABLE sentinel_user_cooldowns DROP CONSTRAINT sentinel_user_cooldowns_pkey;
ALTER TABLE sentinel_user_cooldowns DROP CONSTRAINT IF EXISTS sentinel_user_cooldowns_single_row;
ALTER TABLE sentinel_user_cooldowns DROP COLUMN IF EXISTS id;
-- Add player_id column if it doesn't exist
ALTER TABLE sentinel_user_cooldowns ADD COLUMN IF NOT EXISTS player_id BIGINT;
ALTER TABLE sentinel_user_cooldowns ALTER COLUMN player_id SET NOT NULL;
ALTER TABLE sentinel_user_cooldowns ADD PRIMARY KEY (player_id);
DELETE FROM sentinel_user_cooldowns;
COMMENT ON TABLE sentinel_user_cooldowns IS 'Single Torn user cooldowns. Keyed by player_id.';

-- sentinel_travel_data: Use player_id as primary key
ALTER TABLE sentinel_travel_data DROP CONSTRAINT sentinel_travel_data_pkey;
ALTER TABLE sentinel_travel_data DROP CONSTRAINT IF EXISTS sentinel_travel_data_single_row;
ALTER TABLE sentinel_travel_data DROP COLUMN IF EXISTS id;
-- Drop foreign key if it exists
ALTER TABLE sentinel_travel_data DROP CONSTRAINT IF EXISTS sentinel_travel_data_user_id_fkey;
-- Ensure player_id column exists and is NOT NULL
ALTER TABLE sentinel_travel_data ADD COLUMN IF NOT EXISTS player_id BIGINT;
ALTER TABLE sentinel_travel_data ALTER COLUMN player_id SET NOT NULL;
ALTER TABLE sentinel_travel_data ADD PRIMARY KEY (player_id);
DELETE FROM sentinel_travel_data;
COMMENT ON TABLE sentinel_travel_data IS 'Single Torn user travel state. Keyed by player_id.';

-- sentinel_user_travel_settings: Use player_id as primary key
ALTER TABLE sentinel_user_travel_settings DROP CONSTRAINT sentinel_user_travel_settings_pkey;
ALTER TABLE sentinel_user_travel_settings DROP CONSTRAINT IF EXISTS sentinel_user_travel_settings_single_row;
ALTER TABLE sentinel_user_travel_settings DROP COLUMN IF EXISTS id;
-- Add player_id column if it doesn't exist  
ALTER TABLE sentinel_user_travel_settings ADD COLUMN IF NOT EXISTS player_id BIGINT;
ALTER TABLE sentinel_user_travel_settings ALTER COLUMN player_id SET NOT NULL;
ALTER TABLE sentinel_user_travel_settings ADD PRIMARY KEY (player_id);
DELETE FROM sentinel_user_travel_settings;
COMMENT ON TABLE sentinel_user_travel_settings IS 'Single Torn user travel settings. Keyed by player_id.';

-- sentinel_user_alerts: Keep user_id for now (multi-row alerts per user)
DELETE FROM sentinel_user_alerts;
COMMENT ON TABLE sentinel_user_alerts IS 'Alerts for single Torn user in personalized mode.';
