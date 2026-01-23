-- Rename tables to sentinel_ prefix and tighten RLS on stock cache and trade items

-- Rename market_trends -> sentinel_market_trends
alter table if exists public.market_trends
  rename to sentinel_market_trends;

-- Drop old policies if they exist
alter table public.sentinel_market_trends enable row level security;
drop policy if exists market_trends_select_authenticated on public.sentinel_market_trends;
drop policy if exists market_trends_service_role_all on public.sentinel_market_trends;

-- Recreate policies with sentinel_ names
create policy sentinel_market_trends_select_authenticated on public.sentinel_market_trends
  for select
  to authenticated
  using (true);

create policy sentinel_market_trends_service_role_all on public.sentinel_market_trends
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Rename trade_items -> sentinel_trade_items
alter table if exists public.trade_items
  rename to sentinel_trade_items;

-- Enable RLS and restrict access on sentinel_trade_items
alter table public.sentinel_trade_items enable row level security;

-- Drop any existing policies to avoid conflicts
select
  pol.policyname
from pg_policies pol
where pol.schemaname = 'public'
  and pol.tablename = 'sentinel_trade_items';

-- Authenticated users: read-only
create policy sentinel_trade_items_select_authenticated on public.sentinel_trade_items
  for select
  to authenticated
  using (true);

-- Service role: full access
create policy sentinel_trade_items_service_role_all on public.sentinel_trade_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Enable RLS and restrict access on sentinel_travel_stock_cache (service role only)
alter table public.sentinel_travel_stock_cache enable row level security;

drop policy if exists sentinel_travel_stock_cache_service_role on public.sentinel_travel_stock_cache;
create policy sentinel_travel_stock_cache_service_role on public.sentinel_travel_stock_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
