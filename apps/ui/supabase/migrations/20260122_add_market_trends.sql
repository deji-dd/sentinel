-- Market trends table for pricing and ROI analysis
create table if not exists public.market_trends (
  item_id integer primary key,
  item_name text not null,
  lowest_market_price integer not null,
  market_value integer not null,
  last_updated timestamptz not null default now()
);

-- Enable RLS
alter table public.market_trends enable row level security;

-- Authenticated users: read-only
create policy market_trends_select_authenticated on public.market_trends
  for select
  to authenticated
  using (true);

-- Service role: full access
create policy market_trends_service_role_all on public.market_trends
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
