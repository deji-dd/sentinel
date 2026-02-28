-- Remove legacy guild API key storage from sentinel_guild_config
-- API keys are now stored exclusively in sentinel_guild_api_keys

ALTER TABLE sentinel_guild_config
  DROP COLUMN IF EXISTS api_key,
  DROP COLUMN IF EXISTS api_keys;
