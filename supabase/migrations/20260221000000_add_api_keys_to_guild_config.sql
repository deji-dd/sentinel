-- Add api_keys column for multiple API keys
alter table sentinel_guild_config
  add column if not exists api_keys jsonb default '[]'::jsonb;

-- Backfill api_keys from existing api_key if present
update sentinel_guild_config
set api_keys = jsonb_build_array(
  jsonb_build_object(
    'key', api_key,
    'fingerprint', '????',
    'isActive', true,
    'createdAt', now()::text
  )
)
where api_key is not null
  and api_key <> ''
  and (api_keys is null or jsonb_array_length(api_keys) = 0);
