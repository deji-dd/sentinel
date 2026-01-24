-- TEMP_migrations.sql
-- Apply with: psql "$SUPABASE_DB_URL" -f apps/worker/supabase/migrations/TEMP_migrations.sql
-- Current changes:
-- - Drop legacy market/trade tables
-- - Add torn items, destinations, travel times tables
-- - Seed destinations and torn_items_worker schedule

-- Drop legacy item pricing tables
drop table if exists public.sentinel_market_trends cascade;
drop table if exists public.sentinel_trade_items cascade;

-- Create torn items table
create table if not exists public.sentinel_torn_items (
	item_id integer primary key,
	name text not null,
	image text,
	type text
);

alter table public.sentinel_torn_items enable row level security;

drop policy if exists sentinel_torn_items_service_role on public.sentinel_torn_items;
create policy sentinel_torn_items_service_role on public.sentinel_torn_items
	for all
	using (auth.role() = 'service_role')
	with check (auth.role() = 'service_role');

-- Create destinations
create table if not exists public.sentinel_torn_destinations (
	id serial primary key,
	name text not null unique
);

alter table public.sentinel_torn_destinations enable row level security;

drop policy if exists sentinel_torn_destinations_service_role on public.sentinel_torn_destinations;
create policy sentinel_torn_destinations_service_role on public.sentinel_torn_destinations
	for all
	using (auth.role() = 'service_role')
	with check (auth.role() = 'service_role');

-- Create destination travel times
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

drop policy if exists sentinel_destination_travel_times_service_role on public.sentinel_destination_travel_times;
create policy sentinel_destination_travel_times_service_role on public.sentinel_destination_travel_times
	for all
	using (auth.role() = 'service_role')
	with check (auth.role() = 'service_role');

-- Seed destinations
insert into public.sentinel_torn_destinations (name) values
	('Mexico'),
	('Cayman Islands'),
	('Canada'),
	('Hawaii'),
	('United Kingdom'),
	('Argentina'),
	('Switzerland'),
	('Japan'),
	('China'),
	('UAE'),
	('South Africa')
on conflict (name) do nothing;

-- Update workers seed: add torn_items_worker (daily cadence)
insert into public.sentinel_workers (name)
values ('torn_items_worker')
on conflict (name) do nothing;

insert into public.sentinel_worker_schedules (worker_id, enabled, cadence_seconds, next_run_at)
select id, true, 86400, now()
from public.sentinel_workers
where name = 'torn_items_worker'
on conflict (worker_id) do nothing;
