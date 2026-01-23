-- TEMP_migrations.sql
-- Current changes:
-- - Created sentinel_travel_recommendations table for personalized profit/risk analysis per user/destination

-- Drop and recreate travel recommendations table
drop table if exists public.sentinel_travel_recommendations cascade;

create table public.sentinel_travel_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  destination text not null,
  best_item text,
  profit_per_trip bigint,
  profit_per_minute numeric,
  round_trip_minutes integer,
  recommendation_rank integer,
  status text,
  updated_at timestamptz not null default now()
);

-- Composite unique index for upsert operations (user_id, destination)
-- Allows UPSERT to correctly replace previous recommendation for the same destination
create unique index sentinel_travel_recommendations_user_destination_idx
  on public.sentinel_travel_recommendations (user_id, destination);

-- Additional indexes for common query patterns
create index sentinel_travel_recommendations_user_id_idx
  on public.sentinel_travel_recommendations (user_id);

create index sentinel_travel_recommendations_profit_per_minute_idx
  on public.sentinel_travel_recommendations (profit_per_minute desc);

create index sentinel_travel_recommendations_rank_idx
  on public.sentinel_travel_recommendations (recommendation_rank);

-- Enable RLS
alter table public.sentinel_travel_recommendations enable row level security;

-- Policy: Users can only read their own recommendations
drop policy if exists sentinel_travel_recommendations_select_self on public.sentinel_travel_recommendations;
create policy sentinel_travel_recommendations_select_self
  on public.sentinel_travel_recommendations
  for select
  using (auth.uid() = user_id);

-- Policy: Service role can read/write all
drop policy if exists sentinel_travel_recommendations_service_role on public.sentinel_travel_recommendations;
create policy sentinel_travel_recommendations_service_role
  on public.sentinel_travel_recommendations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Drop and recreate user data snapshot table
drop table if exists public.sentinel_user_data cascade;

create table public.sentinel_user_data (
  user_id text primary key,
  player_id integer not null,
  name text,
  is_donator boolean not null default false,
  profile_image text,
  updated_at timestamptz not null default now()
);

create index sentinel_user_data_player_id_idx
  on public.sentinel_user_data (player_id);

alter table public.sentinel_user_data enable row level security;

drop policy if exists sentinel_user_data_select_self on public.sentinel_user_data;
create policy sentinel_user_data_select_self
  on public.sentinel_user_data
  for select
  using (auth.uid()::text = user_id);

drop policy if exists sentinel_user_data_service_role on public.sentinel_user_data;
create policy sentinel_user_data_service_role
  on public.sentinel_user_data
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Ensure schedule entry for the new worker (1h cadence)
insert into public.sentinel_worker_schedules (worker, enabled, cadence_seconds, next_run_at)
values ('user_data_worker', true, 3600, now())
on conflict (worker) do update set cadence_seconds = excluded.cadence_seconds;
