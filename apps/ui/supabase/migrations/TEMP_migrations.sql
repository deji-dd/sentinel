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

-- Drop and recreate user bars table
drop table if exists public.sentinel_user_bars cascade;

create table public.sentinel_user_bars (
  user_id text primary key,
  energy_current integer not null default 0,
  energy_maximum integer not null default 0,
  nerve_current integer not null default 0,
  nerve_maximum integer not null default 0,
  happy_current integer not null default 0,
  happy_maximum integer not null default 0,
  life_current integer not null default 0,
  life_maximum integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sentinel_user_bars enable row level security;

drop policy if exists sentinel_user_bars_select_self on public.sentinel_user_bars;
create policy sentinel_user_bars_select_self
  on public.sentinel_user_bars
  for select
  using (auth.uid()::text = user_id);

drop policy if exists sentinel_user_bars_service_role on public.sentinel_user_bars;
create policy sentinel_user_bars_service_role
  on public.sentinel_user_bars
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Drop and recreate user cooldowns table
drop table if exists public.sentinel_user_cooldowns cascade;

create table public.sentinel_user_cooldowns (
  user_id text primary key,
  drug integer not null default 0,
  medical integer not null default 0,
  booster integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sentinel_user_cooldowns enable row level security;

drop policy if exists sentinel_user_cooldowns_select_self on public.sentinel_user_cooldowns;
create policy sentinel_user_cooldowns_select_self
  on public.sentinel_user_cooldowns
  for select
  using (auth.uid()::text = user_id);

drop policy if exists sentinel_user_cooldowns_service_role on public.sentinel_user_cooldowns;
create policy sentinel_user_cooldowns_service_role
  on public.sentinel_user_cooldowns
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Ensure schedule entries for new workers (30s cadence)
insert into public.sentinel_worker_schedules (worker, enabled, cadence_seconds, next_run_at)
values 
  ('user_bars_worker', true, 30, now()),
  ('user_cooldowns_worker', true, 30, now())
on conflict (worker) do update set cadence_seconds = excluded.cadence_seconds;

-- --- Worker tables refactor ---
-- Drop old schedule table
drop table if exists public.sentinel_worker_schedules cascade;
drop table if exists public.sentinel_workers cascade;
drop table if exists public.sentinel_worker_logs cascade;

-- Workers registry
create table public.sentinel_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sentinel_workers enable row level security;

create policy sentinel_workers_service_role on public.sentinel_workers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Worker schedules (per-worker, DB-driven)
create table public.sentinel_worker_schedules (
  worker_id uuid primary key references public.sentinel_workers(id) on delete cascade,
  enabled boolean not null default true,
  force_run boolean not null default false,
  cadence_seconds integer not null,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  attempts integer not null default 0,
  backoff_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_sentinel_worker_schedules_next_run
  on public.sentinel_worker_schedules (next_run_at);

alter table public.sentinel_worker_schedules enable row level security;

create policy sentinel_worker_schedules_service_role on public.sentinel_worker_schedules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Worker run logs
create table public.sentinel_worker_logs (
  id bigserial primary key,
  worker_id uuid not null references public.sentinel_workers(id) on delete cascade,
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  duration_ms integer,
  status text not null check (status in ('success','error')),
  message text,
  error_message text,
  created_at timestamptz not null default now()
);

create index sentinel_worker_logs_worker_id_idx
  on public.sentinel_worker_logs (worker_id);

create index sentinel_worker_logs_run_started_idx
  on public.sentinel_worker_logs (run_started_at);

alter table public.sentinel_worker_logs enable row level security;

create policy sentinel_worker_logs_service_role on public.sentinel_worker_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Seed workers and schedules
insert into public.sentinel_workers (name) values
  ('market_trends_worker'),
  ('travel_stock_cache_worker'),
  ('travel_data_worker'),
  ('user_data_worker'),
  ('user_bars_worker'),
  ('user_cooldowns_worker')
on conflict (name) do nothing;

insert into public.sentinel_worker_schedules (worker_id, enabled, cadence_seconds, next_run_at)
select id, true,
  case name
    when 'market_trends_worker' then 300
    when 'travel_stock_cache_worker' then 300
    when 'travel_data_worker' then 30
    when 'user_data_worker' then 3600
    when 'user_bars_worker' then 30
    when 'user_cooldowns_worker' then 30
  end as cadence_seconds,
  now()
from public.sentinel_workers
on conflict (worker_id) do update set cadence_seconds = excluded.cadence_seconds;
