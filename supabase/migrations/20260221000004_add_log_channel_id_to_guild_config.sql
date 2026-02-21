-- Add log_channel_id to guild_config for guild logging
alter table sentinel_guild_config
  add column if not exists log_channel_id text;

comment on column sentinel_guild_config.log_channel_id is 'Discord channel ID for logging automatic bot actions and errors. If set, bot will send logs to this channel.';
