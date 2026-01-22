-- Travel stock cache and recommendations tables

-- Stock cache table: tracks inventory at travel destinations for depletion rate analysis
create table if not exists public.sentinel_travel_stock_cache (
  id bigserial primary key,
  destination text not null,
  item_name text not null,
  item_id integer not null,
  quantity integer not null,
  cost integer not null,
  last_updated timestamptz not null default now()
);

create index if not exists sentinel_travel_stock_cache_destination_idx
  on public.sentinel_travel_stock_cache (destination);

create index if not exists sentinel_travel_stock_cache_item_id_idx
  on public.sentinel_travel_stock_cache (item_id);

create index if not exists sentinel_travel_stock_cache_last_updated_idx
  on public.sentinel_travel_stock_cache (last_updated);

-- Travel recommendations table: personalized profit/risk analysis for users
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

-- Enable RLS on sentinel_travel_recommendations
alter table public.sentinel_travel_recommendations enable row level security;

-- Policy: Users can only read their own recommendations
create policy sentinel_travel_recommendations_select_self on public.sentinel_travel_recommendations
  for select
  using (auth.uid() = user_id);

-- Policy: Service role can read/write all recommendations
create policy sentinel_travel_recommendations_service_role on public.sentinel_travel_recommendations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
