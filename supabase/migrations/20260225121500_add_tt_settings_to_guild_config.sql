-- Add TT notification settings to guild config
alter table sentinel_guild_config
  add column if not exists tt_full_channel_id text,
  add column if not exists tt_filtered_channel_id text,
  add column if not exists tt_territory_ids text[] default '{}',
  add column if not exists tt_faction_ids integer[] default '{}';
