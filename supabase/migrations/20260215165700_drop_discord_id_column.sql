-- Drop discord_id column and related constraints from sentinel_user_data
-- Discord sync is deprecated as the travel module (which was the only consumer) is now disabled

-- Drop index on discord_id
DROP INDEX IF EXISTS "public"."sentinel_user_data_discord_id_idx";

-- Drop unique constraint on discord_id
ALTER TABLE "public"."sentinel_user_data" 
    DROP CONSTRAINT IF EXISTS "sentinel_user_data_discord_id_key";

-- Drop the discord_id column
ALTER TABLE "public"."sentinel_user_data" 
    DROP COLUMN IF EXISTS "discord_id";

COMMENT ON TABLE "public"."sentinel_user_data" 
    IS 'Single Torn user profile data. Keyed by player_id. Discord integration removed.';
