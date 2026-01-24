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
	name text not null unique,
	country_code text not null unique
);

-- Backfill/add country_code if the table already existed without it
alter table public.sentinel_torn_destinations
  add column if not exists country_code text;

create unique index if not exists sentinel_torn_destinations_country_code_idx
  on public.sentinel_torn_destinations (country_code);

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
-- Backfill country_code for existing rows by name
update public.sentinel_torn_destinations
set country_code = case lower(name)
  when 'mexico' then 'mex'
  when 'cayman islands' then 'cay'
  when 'canada' then 'can'
  when 'hawaii' then 'haw'
  when 'united kingdom' then 'uni'
  when 'argentina' then 'arg'
  when 'switzerland' then 'swi'
  when 'japan' then 'jap'
  when 'china' then 'chi'
  when 'united arab emirates' then 'uae'
  when 'uae' then 'uae'
  when 'south africa' then 'sou'
  else country_code
end
where country_code is null;

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

-- Seed travel times
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

-- Ensure travel stock cache has required columns
create table if not exists public.sentinel_travel_stock_cache (
	id bigserial primary key,
	destination_id integer references public.sentinel_torn_destinations(id) on delete cascade,
	item_id integer,
	quantity integer not null,
	cost bigint not null,
	last_updated timestamptz not null default now()
);

alter table public.sentinel_travel_stock_cache
	add column if not exists destination_id integer;

alter table public.sentinel_travel_stock_cache
	add column if not exists item_id integer;

-- Add FK constraint for destination_id if missing
do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conrelid = 'public.sentinel_travel_stock_cache'::regclass
			and conname = 'sentinel_travel_stock_cache_destination_id_fkey'
	) then
		alter table public.sentinel_travel_stock_cache
			add constraint sentinel_travel_stock_cache_destination_id_fkey
			foreign key (destination_id) references public.sentinel_torn_destinations(id) on delete cascade;
	end if;
end$$;

create index if not exists sentinel_travel_stock_cache_destination_idx
	on public.sentinel_travel_stock_cache (destination_id);

create index if not exists sentinel_travel_stock_cache_item_id_idx
	on public.sentinel_travel_stock_cache (item_id);

create index if not exists sentinel_travel_stock_cache_last_updated_idx
	on public.sentinel_travel_stock_cache (last_updated);

-- Backfill new FK columns from legacy data if present
-- Map legacy destination name -> destination_id
update public.sentinel_travel_stock_cache s
set destination_id = d.id
from public.sentinel_torn_destinations d
where s.destination_id is null
	and lower(s.destination) = lower(d.name);

-- Map legacy item_name -> item_id
update public.sentinel_travel_stock_cache s
set item_id = i.item_id
from public.sentinel_torn_items i
where s.item_id is null
	and s.item_name = i.name;

-- Drop legacy columns now that FKs are in place
alter table public.sentinel_travel_stock_cache
	drop column if exists destination;

alter table public.sentinel_travel_stock_cache
	drop column if exists item_name;

-- Remove any rows that could not be backfilled (cache table)
delete from public.sentinel_travel_stock_cache
where destination_id is null
	 or item_id is null;

-- Enforce NOT NULL on new FK columns
alter table public.sentinel_travel_stock_cache
	alter column destination_id set not null;

alter table public.sentinel_travel_stock_cache
	alter column item_id set not null;

-- Update workers seed: add torn_items_worker (daily cadence)
insert into public.sentinel_workers (name)
values ('torn_items_worker')
on conflict (name) do nothing;

insert into public.sentinel_worker_schedules (worker_id, enabled, cadence_seconds, next_run_at)
select id, true, 86400, now()
from public.sentinel_workers
where name = 'torn_items_worker'
on conflict (worker_id) do nothing;

-- Refresh PostgREST schema cache so new columns are visible immediately
notify pgrst, 'reload schema';

-- Add time-to-full columns to sentinel_user_bars
alter table public.sentinel_user_bars
  add column if not exists energy_flat_time_to_full integer;

alter table public.sentinel_user_bars
  add column if not exists energy_time_to_full integer;

alter table public.sentinel_user_bars
  add column if not exists nerve_flat_time_to_full integer;

alter table public.sentinel_user_bars
  add column if not exists nerve_time_to_full integer;

-- Update sentinel_travel_recommendations: add destination_id, best_item_id, message
alter table public.sentinel_travel_recommendations
  add column if not exists destination_id integer;

alter table public.sentinel_travel_recommendations
  add column if not exists best_item_id integer;

alter table public.sentinel_travel_recommendations
  add column if not exists message text;

-- Backfill destination_id from destination name
update public.sentinel_travel_recommendations r
set destination_id = d.id
from public.sentinel_torn_destinations d
where r.destination_id is null
  and lower(r.destination) = lower(d.name);

-- Backfill best_item_id from best_item name
update public.sentinel_travel_recommendations r
set best_item_id = i.item_id
from public.sentinel_torn_items i
where r.best_item_id is null
  and r.best_item = i.name;

-- Copy status to message
update public.sentinel_travel_recommendations
set message = status
where message is null and status is not null;

-- Drop legacy columns
alter table public.sentinel_travel_recommendations
  drop column if exists destination;

alter table public.sentinel_travel_recommendations
  drop column if exists best_item;

alter table public.sentinel_travel_recommendations
  drop column if exists status;

-- Add FK constraint for destination_id if missing
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sentinel_travel_recommendations'::regclass
      and conname = 'sentinel_travel_recommendations_destination_id_fkey'
  ) then
    alter table public.sentinel_travel_recommendations
      add constraint sentinel_travel_recommendations_destination_id_fkey
      foreign key (destination_id) references public.sentinel_torn_destinations(id) on delete cascade;
  end if;
end$$;

-- Enforce NOT NULL on destination_id
alter table public.sentinel_travel_recommendations
  alter column destination_id set not null;

-- Drop old unique index and create new one
drop index if exists public.sentinel_travel_recommendations_user_destination_idx;

create unique index if not exists sentinel_travel_recommendations_user_destination_idx
  on public.sentinel_travel_recommendations (user_id, destination_id);

-- Refresh schema again for travel_recommendations changes
notify pgrst, 'reload schema';
