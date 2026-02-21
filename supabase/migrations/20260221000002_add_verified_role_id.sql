-- Add verified_role_id to guild_config for default verification role
alter table sentinel_guild_config
  add column if not exists verified_role_id text;

comment on column sentinel_guild_config.verified_role_id is 'Role assigned to all verified members (before faction-specific roles)';
