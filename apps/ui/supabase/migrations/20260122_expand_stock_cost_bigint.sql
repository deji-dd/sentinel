-- Expand sentinel_travel_stock_cache.cost to bigint for large item values

alter table public.sentinel_travel_stock_cache
  alter column cost type bigint;
