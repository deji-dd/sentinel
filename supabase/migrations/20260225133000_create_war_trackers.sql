create table if not exists public.sentinel_war_trackers (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.sentinel_guild_config(guild_id) on delete cascade,
  war_id integer not null,
  territory_id text not null,
  channel_id text,
  message_id text,
  enemy_side text not null check (enemy_side in ('assaulting', 'defending')),
  min_away_minutes integer not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique (guild_id, war_id)
);

create index if not exists sentinel_war_trackers_guild_id_idx
  on public.sentinel_war_trackers (guild_id);

create index if not exists sentinel_war_trackers_channel_id_idx
  on public.sentinel_war_trackers (channel_id);
