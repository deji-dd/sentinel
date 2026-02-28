-- Create TT module configuration table
-- Stores per-guild TT settings including notification filters
create table sentinel_tt_config (
  guild_id text primary key references sentinel_guild_config(guild_id) on delete cascade,
  -- Notification type determines what changes trigger alerts:
  -- 'all' = all ownership changes
  -- 'territories' = only changes to territory_ids (must also have territory_ids set)
  -- 'factions' = only changes affecting faction_ids (must also have faction_ids set)
  -- 'combined' = changes to territorial_ids OR factions in faction_ids (must have both arrays set)
  notification_type text not null default 'all' check (notification_type in ('all', 'territories', 'factions', 'combined')),
  -- Specific TT IDs to monitor (used with 'territories' or 'combined' type)
  territory_ids text[] default '{}',
  -- Specific faction IDs to monitor (used with 'factions' or 'combined' type)
  faction_ids integer[] default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create index for guild lookup
create index idx_tt_config_guild_id on sentinel_tt_config(guild_id);

-- Enable RLS and set policies
alter table sentinel_tt_config enable row level security;

create policy "service_role manages tt_config"
  on sentinel_tt_config
  for all
  to service_role
  using (true)
  with check (true);

create policy "public reads tt_config"
  on sentinel_tt_config
  for select
  to public
  using (true);

-- Grant permissions
grant all on table sentinel_tt_config to service_role;
grant select on table sentinel_tt_config to anon, authenticated;
