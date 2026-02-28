-- Convert system and guild key tables to use Torn player IDs (INTEGER) instead of auth.users UUIDs

-- System API keys
DROP INDEX IF EXISTS sentinel_system_api_keys_user_id_idx;
DROP INDEX IF EXISTS sentinel_system_api_keys_primary_idx;
ALTER TABLE sentinel_system_api_keys DROP CONSTRAINT IF EXISTS system_api_keys_unique;

TRUNCATE TABLE sentinel_system_api_keys;

ALTER TABLE sentinel_system_api_keys DROP COLUMN IF EXISTS user_id;
ALTER TABLE sentinel_system_api_keys ADD COLUMN user_id INTEGER NOT NULL;

ALTER TABLE sentinel_system_api_keys
  ADD CONSTRAINT system_api_keys_unique UNIQUE(user_id, api_key_encrypted);

CREATE INDEX sentinel_system_api_keys_user_id_idx
  ON sentinel_system_api_keys(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX sentinel_system_api_keys_primary_idx
  ON sentinel_system_api_keys(user_id, is_primary)
  WHERE deleted_at IS NULL;

-- Guild API keys
DROP INDEX IF EXISTS sentinel_guild_api_keys_user_id_idx;

TRUNCATE TABLE sentinel_guild_api_keys;

ALTER TABLE sentinel_guild_api_keys DROP COLUMN IF EXISTS user_id;
ALTER TABLE sentinel_guild_api_keys ADD COLUMN user_id INTEGER NOT NULL;

CREATE INDEX sentinel_guild_api_keys_user_id_idx
  ON sentinel_guild_api_keys(user_id)
  WHERE deleted_at IS NULL;
