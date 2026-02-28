-- Add api_key_hash to system API keys for deduplication

ALTER TABLE sentinel_system_api_keys
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT;

-- Drop old unique constraint if present
ALTER TABLE sentinel_system_api_keys
  DROP CONSTRAINT IF EXISTS system_api_keys_unique;

-- Ensure api_key_hash is unique for active keys
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_system_api_keys_api_key_hash_unique
  ON sentinel_system_api_keys(api_key_hash)
  WHERE deleted_at IS NULL AND api_key_hash IS NOT NULL;
