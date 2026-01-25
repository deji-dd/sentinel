-- Baseline schema for fresh forks (run on a new database only)
-- Consolidates previous migrations into a single snapshot.

create extension if not exists "pgcrypto";

-- Users
create table if not exists public.sentinel_users (
  user_id text primary key,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.sentinel_users_update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sentinel_users_set_updated_at on public.sentinel_users;
create trigger sentinel_users_set_updated_at
before update on public.sentinel_users
for each row
execute procedure public.sentinel_users_update_timestamp();

alter table public.sentinel_users enable row level security;

create policy if not exists sentinel_users_select_self on public.sentinel_users
  for select
  using (auth.uid()::text = user_id);

create policy if not exists sentinel_users_update_self on public.sentinel_users
  for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- User API keys
create table if not exists public.sentinel_user_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

alter table public.sentinel_user_keys enable row level security;

create policy if not exists sentinel_user_keys_select_self on public.sentinel_user_keys
  for select
  using (auth.uid() = user_id);

create policy if not exists sentinel_user_keys_update_self on public.sentinel_user_keys
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists sentinel_user_keys_insert_self on public.sentinel_user_keys
  for insert
  with check (auth.uid() = user_id);

create or replace function public.store_user_key(
  user_id uuid,
  api_key text
)
returns void as $$
begin
  insert into public.sentinel_user_keys (user_id, api_key, created_at, updated_at)
  values (user_id, api_key, now(), now())
  on conflict (user_id) do update
  set api_key = excluded.api_key, updated_at = now();
end;
$$ language plpgsql security definer;

-- User data (profile snapshot)
create table if not exists public.sentinel_user_data (
  user_id text primary key,
  player_id integer not null,
  name text,
  is_donator boolean not null default false,
  profile_image text,
  discord_id text unique,
  updated_at timestamptz not null default now()
);

create index if not exists sentinel_user_data_player_id_idx
  on public.sentinel_user_data (player_id);

create index if not exists sentinel_user_data_discord_id_idx
  on public.sentinel_user_data (discord_id)
  where discord_id is not null;

alter table public.sentinel_user_data enable row level security;

create policy if not exists sentinel_user_data_select_self on public.sentinel_user_data
  for select
  using (auth.uid()::text = user_id);

create policy if not exists sentinel_user_data_service_role on public.sentinel_user_data
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
-- User bars (energy, nerve, happy, life snapshot)
create table if not exists public.sentinel_user_bars (
  user_id text primary key,
  energy_current integer not null default 0,
  energy_maximum integer not null default 0,
  nerve_current integer not null default 0,
  nerve_maximum integer not null default 0,
  happy_current integer not null default 0,
  happy_maximum integer not null default 0,
  life_current integer not null default 0,
  life_maximum integer not null default 0,
  energy_flat_time_to_full integer,
  energy_time_to_full integer,
  nerve_flat_time_to_full integer,
  nerve_time_to_full integer,
  updated_at timestamptz not null default now()
);

alter table public.sentinel_user_bars enable row level security;

create policy if not exists sentinel_user_bars_select_self on public.sentinel_user_bars
  for select
  using (auth.uid()::text = user_id);

create policy if not exists sentinel_user_bars_service_role on public.sentinel_user_bars
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- User cooldowns (drug, medical, booster)
create table if not exists public.sentinel_user_cooldowns (
  user_id text primary key,
  drug integer not null default 0,
  medical integer not null default 0,
  booster integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sentinel_user_cooldowns enable row level security;

create policy if not exists sentinel_user_cooldowns_select_self on public.sentinel_user_cooldowns
  for select
  using (auth.uid()::text = user_id);

create policy if not exists sentinel_user_cooldowns_service_role on public.sentinel_user_cooldowns
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
-- Torn items
create table if not exists public.sentinel_torn_items (
  item_id integer primary key,
  name text not null,
  image text,
  type text
);

alter table public.sentinel_torn_items enable row level security;

create policy if not exists sentinel_torn_items_service_role on public.sentinel_torn_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Destinations
create table if not exists public.sentinel_torn_destinations (
  id serial primary key,
  name text not null unique,
  country_code text not null unique
);

alter table public.sentinel_torn_destinations enable row level security;

create policy if not exists sentinel_torn_destinations_service_role on public.sentinel_torn_destinations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Destination travel times (minutes)
create table if not exists public.sentinel_destination_travel_times (
  destination_id integer primary key references public.sentinel_torn_destinations(id) on delete cascade,
  standard integer not null default 0,
  airstrip integer not null default 0,
  wlt integer not null default 0,
  bct integer not null default 0,
  standard_w_book integer not null default 0,
  airstrip_w_book integer not null default 0,
  wlt_w_book integer not null default 0,
  bct_w_book integer not null default 0,
  standard_cost integer not null default 0
);

alter table public.sentinel_destination_travel_times enable row level security;

create policy if not exists sentinel_destination_travel_times_service_role on public.sentinel_destination_travel_times
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Seed destinations
insert into public.sentinel_torn_destinations (name, country_code) values
  ('Mexico', 'mex'),
  ('Cayman Islands', 'cay'),
  ('Canada', 'can'),
  ('Hawaii', 'haw'),
  ('United Kingdom', 'uni'),
  ('Argentina', 'arg'),
  ('Switzerland', 'swi'),
  ('Japan', 'jap'),
  ('China', 'chi'),
  ('United Arab Emirates', 'uae'),
  ('South Africa', 'sou')
on conflict (country_code) do nothing;

-- Seed destination travel times (minutes)
insert into public.sentinel_destination_travel_times (
  destination_id,
  standard_cost,
  standard,
  airstrip,
  wlt,
  bct,
  standard_w_book,
  airstrip_w_book,
  wlt_w_book,
  bct_w_book
)
select d.id,
  v.standard_cost,
  v.standard,
  v.airstrip,
  v.wlt,
  v.bct,
  v.standard_w_book,
  v.airstrip_w_book,
  v.wlt_w_book,
  v.bct_w_book
from (values
  ('mex', 6500, 26, 18, 13, 8, 20, 14, 10, 6),
  ('cay', 10000, 35, 25, 18, 11, 26, 19, 14, 8),
  ('can', 9000, 41, 29, 20, 12, 31, 22, 15, 9),
  ('haw', 11000, 134, 94, 67, 40, 101, 71, 50, 30),
  ('uni', 18000, 159, 111, 80, 48, 119, 83, 60, 36),
  ('arg', 21000, 167, 117, 83, 50, 125, 88, 62, 38),
  ('swi', 27000, 175, 123, 88, 53, 131, 92, 66, 40),
  ('jap', 32000, 225, 158, 113, 68, 169, 119, 85, 51),
  ('chi', 35000, 242, 169, 121, 72, 182, 127, 91, 54),
  ('uae', 32000, 271, 190, 135, 81, 203, 143, 101, 61),
  ('sou', 40000, 297, 208, 149, 89, 223, 156, 112, 67)
) as v(code, standard_cost, standard, airstrip, wlt, bct, standard_w_book, airstrip_w_book, wlt_w_book, bct_w_book)
join public.sentinel_torn_destinations d on d.country_code = v.code
on conflict (destination_id) do nothing;

-- Travel stock cache
create table if not exists public.sentinel_travel_stock_cache (
  id bigserial primary key,
  destination_id integer not null references public.sentinel_torn_destinations(id) on delete cascade,
  item_id integer not null,
  quantity integer not null,
  cost bigint not null,
  last_updated timestamptz not null default now(),
  ingested_at timestamptz not null default now()
);

create index if not exists sentinel_travel_stock_cache_destination_idx
  on public.sentinel_travel_stock_cache (destination_id);

create index if not exists sentinel_travel_stock_cache_item_id_idx
  on public.sentinel_travel_stock_cache (item_id);

create index if not exists sentinel_travel_stock_cache_last_updated_idx
  on public.sentinel_travel_stock_cache (last_updated);

create index if not exists sentinel_travel_stock_cache_ingested_idx
  on public.sentinel_travel_stock_cache (ingested_at);

alter table public.sentinel_travel_stock_cache enable row level security;

drop policy if exists sentinel_travel_stock_cache_service_role on public.sentinel_travel_stock_cache;
create policy sentinel_travel_stock_cache_service_role on public.sentinel_travel_stock_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Travel recommendations
create table if not exists public.sentinel_travel_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  destination_id integer not null references public.sentinel_torn_destinations(id) on delete cascade,
  best_item_id integer,
  profit_per_trip bigint,
  profit_per_minute numeric,
  round_trip_minutes integer,
  recommendation_rank integer,
  message text,
  updated_at timestamptz not null default now()
);

-- Composite unique index for upsert operations (user_id, destination_id)
create unique index if not exists sentinel_travel_recommendations_user_destination_idx
  on public.sentinel_travel_recommendations (user_id, destination_id);

-- Additional indexes for common query patterns
create index if not exists sentinel_travel_recommendations_user_id_idx
  on public.sentinel_travel_recommendations (user_id);

create index if not exists sentinel_travel_recommendations_profit_per_minute_idx
  on public.sentinel_travel_recommendations (profit_per_minute desc);

create index if not exists sentinel_travel_recommendations_rank_idx
  on public.sentinel_travel_recommendations (recommendation_rank);

alter table public.sentinel_travel_recommendations enable row level security;

drop policy if exists sentinel_travel_recommendations_select_self on public.sentinel_travel_recommendations;
create policy sentinel_travel_recommendations_select_self on public.sentinel_travel_recommendations
  for select
  using (auth.uid() = user_id);

drop policy if exists sentinel_travel_recommendations_service_role on public.sentinel_travel_recommendations;
create policy sentinel_travel_recommendations_service_role on public.sentinel_travel_recommendations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Travel data
create table if not exists public.sentinel_travel_data (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  travel_destination text,
  travel_method text,
  travel_departed_at timestamptz,
  travel_arrival_at timestamptz,
  travel_time_left integer,
  capacity integer not null default 5,
    has_airstrip boolean not null default false,
    has_wlt_benefit boolean not null default false,
    active_travel_book boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists sentinel_travel_data_user_id_idx
  on public.sentinel_travel_data (user_id);

create or replace function public.sentinel_travel_data_update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sentinel_travel_data_set_updated_at on public.sentinel_travel_data;
create trigger sentinel_travel_data_set_updated_at
before update on public.sentinel_travel_data
for each row
execute procedure public.sentinel_travel_data_update_timestamp();

alter table public.sentinel_travel_data enable row level security;

create policy if not exists sentinel_travel_data_select_self on public.sentinel_travel_data
  for select
  using (auth.uid()::text = user_id);

create policy if not exists sentinel_travel_data_service_role on public.sentinel_travel_data
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Workers registry
create table if not exists public.sentinel_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sentinel_workers enable row level security;

create policy if not exists sentinel_workers_service_role on public.sentinel_workers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Worker schedules (per-worker, DB-driven)
create table if not exists public.sentinel_worker_schedules (
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

create index if not exists idx_sentinel_worker_schedules_next_run
  on public.sentinel_worker_schedules (next_run_at);

alter table public.sentinel_worker_schedules enable row level security;

create policy if not exists sentinel_worker_schedules_service_role on public.sentinel_worker_schedules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Worker run logs
create table if not exists public.sentinel_worker_logs (
  id bigserial primary key,
  worker_id uuid not null references public.sentinel_workers(id) on delete cascade,
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  duration_ms integer,
  status text not null check (status in ('success','error')),
  message text,
  error_message text,
  is_limited boolean default false,
  limited_until timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sentinel_worker_logs_worker_id_idx
  on public.sentinel_worker_logs (worker_id);

create index if not exists sentinel_worker_logs_run_started_idx
  on public.sentinel_worker_logs (run_started_at);

alter table public.sentinel_worker_logs enable row level security;

create policy if not exists sentinel_worker_logs_service_role on public.sentinel_worker_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Seed workers and schedules
insert into public.sentinel_workers (name) values
  ('travel_stock_cache_worker'),
  ('travel_data_worker'),
  ('user_data_worker'),
  ('user_bars_worker'),
  ('user_cooldowns_worker'),
  ('torn_items_worker')
on conflict (name) do nothing;

insert into public.sentinel_worker_schedules (worker_id, enabled, cadence_seconds, next_run_at)
select id, true,
  case name
    when 'travel_stock_cache_worker' then 300
    when 'travel_data_worker' then 30
    when 'user_data_worker' then 3600
    when 'user_bars_worker' then 30
    when 'user_cooldowns_worker' then 30
    when 'torn_items_worker' then 86400
  end as cadence_seconds,
  now()
from public.sentinel_workers
on conflict (worker_id) do nothing;

create policy if not exists sentinel_worker_schedules_service_role on public.sentinel_worker_schedules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Worker run logs (retained as needed)
create table if not exists public.sentinel_worker_logs (
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

create index if not exists sentinel_worker_logs_worker_id_idx
  on public.sentinel_worker_logs (worker_id);

create index if not exists sentinel_worker_logs_run_started_idx
  on public.sentinel_worker_logs (run_started_at);

alter table public.sentinel_worker_logs enable row level security;

create policy if not exists sentinel_worker_logs_service_role on public.sentinel_worker_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Rate limit request tracker (persists across restarts)
create table if not exists public.sentinel_rate_limit_requests (
  id bigserial primary key,
  requested_at timestamptz not null default now()
);

create index if not exists sentinel_rate_limit_requests_requested_at_idx
  on public.sentinel_rate_limit_requests (requested_at desc);

alter table public.sentinel_rate_limit_requests enable row level security;

create policy if not exists sentinel_rate_limit_requests_service_role on public.sentinel_rate_limit_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Cleanup legacy tables if present
-- These existed before the sentinel_ prefix refactor and per-worker scheduler
-- Drop cautiously; they should not exist in a fresh fork

-- Old unprefixed tables
-- drop table if exists public.user_keys cascade;
-- drop table if exists public.user_data cascade;
-- drop table if exists public.user_worker_schedules cascade;
-- drop table if exists public.market_trends cascade;
-- drop table if exists public.trade_items cascade;
-- drop table if exists public.user_worker_schedules cascade;

-- Prefixed but deprecated tables
-- drop table if exists public.sentinel_user_worker_schedules cascade;
-- drop table if exists public.sentinel_users_data cascade;
