-- Fix api_key_user_mapping schema to use Torn player IDs instead of auth.users UUIDs
-- Drop and recreate the user_id column as INTEGER

-- Drop the old index
DROP INDEX IF EXISTS sentinel_api_key_user_mapping_user_id_idx;

-- Drop the user_id column (which includes the foreign key)
ALTER TABLE sentinel_api_key_user_mapping DROP COLUMN user_id;

-- Recreate user_id column as INTEGER for Torn player IDs
ALTER TABLE sentinel_api_key_user_mapping ADD COLUMN user_id INTEGER NOT NULL;

-- Recreate index
CREATE INDEX sentinel_api_key_user_mapping_user_id_idx ON sentinel_api_key_user_mapping(user_id) WHERE deleted_at IS NULL;
