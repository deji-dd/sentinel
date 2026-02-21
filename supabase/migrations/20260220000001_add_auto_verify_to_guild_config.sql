-- Add auto_verify setting to guild_config
alter table sentinel_guild_config
  add column auto_verify boolean default false;
