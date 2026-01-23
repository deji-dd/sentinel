-- Baseline schema for fresh forks (run on a new database only)
-- Consolidates previous migrations into a single snapshot.

create extension if not exists "pgcrypto";

-- Users
create table if not exists public.sentinel_users (
  user_id text primary key,
  player_id integer not null,
  name text,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sentinel_users_player_id_idx on public.sentinel_users (player_id);

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

-- Trade items
create table if not exists public.sentinel_trade_items (
  item_id integer primary key,
  name text not null,
  category text not null,
  is_active boolean not null default true
);

alter table public.sentinel_trade_items enable row level security;

create policy if not exists sentinel_trade_items_select_authenticated on public.sentinel_trade_items
  for select
  to authenticated
  using (true);

create policy if not exists sentinel_trade_items_service_role_all on public.sentinel_trade_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Market trends
create table if not exists public.sentinel_market_trends (
  item_id integer primary key,
  item_name text not null,
  lowest_market_price integer not null,
  market_value integer not null,
  last_updated timestamptz not null default now()
);

alter table public.sentinel_market_trends enable row level security;

create policy if not exists sentinel_market_trends_select_authenticated on public.sentinel_market_trends
  for select
  to authenticated
  using (true);

create policy if not exists sentinel_market_trends_service_role_all on public.sentinel_market_trends
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Travel stock cache
create table if not exists public.sentinel_travel_stock_cache (
  id bigserial primary key,
  destination text not null,
  item_name text not null,
  item_id integer not null,
  quantity integer not null,
  cost bigint not null,
  last_updated timestamptz not null default now()
);

create index if not exists sentinel_travel_stock_cache_destination_idx
  on public.sentinel_travel_stock_cache (destination);

create index if not exists sentinel_travel_stock_cache_item_id_idx
  on public.sentinel_travel_stock_cache (item_id);

create index if not exists sentinel_travel_stock_cache_last_updated_idx
  on public.sentinel_travel_stock_cache (last_updated);

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
  destination text not null,
  recommended_item text not null,
  profit_per_trip numeric not null,
  profit_per_minute numeric not null,
  depletion_risk text not null check (depletion_risk in ('Low', 'Moderate', 'High')),
  recommendation_score numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists sentinel_travel_recommendations_user_id_idx
  on public.sentinel_travel_recommendations (user_id);

create index if not exists sentinel_travel_recommendations_user_destination_idx
  on public.sentinel_travel_recommendations (user_id, destination);

create index if not exists sentinel_travel_recommendations_created_at_idx
  on public.sentinel_travel_recommendations (created_at);

alter table public.sentinel_travel_recommendations enable row level security;

create policy if not exists sentinel_travel_recommendations_select_self on public.sentinel_travel_recommendations
  for select
  using (auth.uid() = user_id);

create policy if not exists sentinel_travel_recommendations_service_role on public.sentinel_travel_recommendations
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
  capacity_manually_set boolean not null default false,
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

-- RPC to allow users to set their travel capacity (locks it from worker updates)
create or replace function public.set_user_travel_capacity(capacity_value integer)
returns void as $$
begin
  update public.sentinel_travel_data
  set capacity = capacity_value,
      capacity_manually_set = true,
      updated_at = now()
  where user_id = auth.uid()::text;
end;
$$ language plpgsql security definer set search_path = public;

-- Worker schedules (per-worker, DB-driven)
create table if not exists public.sentinel_worker_schedules (
  worker text primary key,
  enabled boolean not null default true,
  force_run boolean not null default false,
  cadence_seconds integer not null,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  status text,
  error_message text,
  attempts integer not null default 0,
  backoff_until timestamptz,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sentinel_worker_schedules_next_run
  on public.sentinel_worker_schedules (next_run_at);

alter table public.sentinel_worker_schedules enable row level security;

insert into public.sentinel_worker_schedules (worker, enabled, cadence_seconds, next_run_at)
values 
  ('market_trends_worker', true, 300, now()),
  ('travel_stock_cache_worker', true, 300, now()),
  ('travel_data_worker', true, 30, now())
on conflict (worker) do nothing;

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
