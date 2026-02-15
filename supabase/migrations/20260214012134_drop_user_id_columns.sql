-- Migration: Remove user_id UUID columns
-- 
-- Clean up legacy multi-user schema by dropping user_id columns
-- from all data tables. We now use player_id (Torn ID) as the sole identifier
-- for the personalized single-user mode.

-- Drop user_id from sentinel_user_data (if it exists)
ALTER TABLE sentinel_user_data DROP COLUMN IF EXISTS user_id CASCADE;

-- Drop user_id from sentinel_user_bars (if it exists)
ALTER TABLE sentinel_user_bars DROP COLUMN IF EXISTS user_id CASCADE;

-- Drop user_id from sentinel_user_cooldowns (if it exists)
ALTER TABLE sentinel_user_cooldowns DROP COLUMN IF EXISTS user_id CASCADE;

-- Drop user_id from sentinel_travel_data (if it exists)
ALTER TABLE sentinel_travel_data DROP COLUMN IF EXISTS user_id CASCADE;

-- Drop user_id from sentinel_user_travel_settings (if it exists)
ALTER TABLE sentinel_user_travel_settings DROP COLUMN IF EXISTS user_id CASCADE;

-- Note: sentinel_user_alerts still has user_id for multi-row alerts
-- but it's a BIGINT, not a UUID, so it will be kept
