-- Migration: Refactor database tables for single-user personalized mode
--
-- In a personalized single-user application, there's no need for `user_id` primary keys.
-- Data should be stored as singletons (one row per table) rather than per-user rows.
--
-- This migration:
-- 1. Removes `user_id` from PRIMARY KEY for data tables
-- 2. Adds auto-incrementing ID as primary key
-- 3. Drops existing data (fresh start for personalized app)
-- 4. Adds CHECK constraints to enforce single-row storage

-- sentinel_user_data: Store single user's profile data
ALTER TABLE sentinel_user_data DROP CONSTRAINT sentinel_user_data_pkey;
ALTER TABLE sentinel_user_data ADD COLUMN id SERIAL PRIMARY KEY;
DELETE FROM sentinel_user_data;
ALTER TABLE sentinel_user_data ADD CONSTRAINT sentinel_user_data_single_row CHECK (id = 1);
COMMENT ON TABLE sentinel_user_data IS 'Single-user personalized data. Contains only one row of profile data.';

-- sentinel_user_bars: Store single user's current bars
ALTER TABLE sentinel_user_bars DROP CONSTRAINT sentinel_user_bars_pkey;
ALTER TABLE sentinel_user_bars ADD COLUMN id SERIAL PRIMARY KEY;
DELETE FROM sentinel_user_bars;
ALTER TABLE sentinel_user_bars ADD CONSTRAINT sentinel_user_bars_single_row CHECK (id = 1);
COMMENT ON TABLE sentinel_user_bars IS 'Single-user personalized bars (energy, nerve, happiness, life). Contains only one row.';

-- sentinel_user_cooldowns: Store single user's cooldowns
ALTER TABLE sentinel_user_cooldowns DROP CONSTRAINT sentinel_user_cooldowns_pkey;
ALTER TABLE sentinel_user_cooldowns ADD COLUMN id SERIAL PRIMARY KEY;
DELETE FROM sentinel_user_cooldowns;
ALTER TABLE sentinel_user_cooldowns ADD CONSTRAINT sentinel_user_cooldowns_single_row CHECK (id = 1);
COMMENT ON TABLE sentinel_user_cooldowns IS 'Single-user personalized cooldowns. Contains only one row.';

-- sentinel_travel_data: Store single user's travel state
ALTER TABLE sentinel_travel_data DROP CONSTRAINT sentinel_travel_data_pkey;
ALTER TABLE sentinel_travel_data DROP CONSTRAINT sentinel_travel_data_user_id_fkey;
ALTER TABLE sentinel_travel_data ADD COLUMN id SERIAL PRIMARY KEY;
DELETE FROM sentinel_travel_data;
ALTER TABLE sentinel_travel_data ADD CONSTRAINT sentinel_travel_data_single_row CHECK (id = 1);
COMMENT ON TABLE sentinel_travel_data IS 'Single-user personalized travel data. Contains only one row of travel status.';

-- sentinel_user_travel_settings: Store single user's travel prefs
ALTER TABLE sentinel_user_travel_settings DROP CONSTRAINT sentinel_user_travel_settings_pkey;
ALTER TABLE sentinel_user_travel_settings ADD COLUMN id SERIAL PRIMARY KEY;
DELETE FROM sentinel_user_travel_settings;
ALTER TABLE sentinel_user_travel_settings ADD CONSTRAINT sentinel_user_travel_settings_single_row CHECK (id = 1);
COMMENT ON TABLE sentinel_user_travel_settings IS 'Single-user personalized travel settings. Contains only one row.';

-- sentinel_travel_recommendations: Keep user_id for now but document single-row usage
DELETE FROM sentinel_travel_recommendations;
-- Note: This table has multiple rows (one per destination) so we keep user_id for potential future use
COMMENT ON TABLE sentinel_travel_recommendations IS 'Travel recommendations per destination. Single user in personalized mode.';

-- sentinel_user_alerts: Track alerts for single user
DELETE FROM sentinel_user_alerts;
COMMENT ON TABLE sentinel_user_alerts IS 'User alerts for single user in personalized mode.';

-- Drop the deprecated multi-user sentinel_users table data
DELETE FROM sentinel_users;
COMMENT ON TABLE sentinel_users IS 'DEPRECATED: No longer used in personalized single-user mode. Data removed.';
