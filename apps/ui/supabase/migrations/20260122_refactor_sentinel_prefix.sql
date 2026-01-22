-- Refactor: separate travel data into dedicated table, add sentinel_ prefix, disable RLS on worker_schedules

-- Rename user_keys to sentinel_user_keys
alter table if exists public.user_keys
  rename to sentinel_user_keys;

-- Rename user_data to sentinel_user_data and drop travel columns
alter table if exists public.user_data
  drop column if exists travel_destination,
  drop column if exists travel_method,
  drop column if exists travel_departed_at,
  drop column if exists travel_arrival_at,
  drop column if exists travel_time_left;

alter table if exists public.user_data
  rename to sentinel_user_data;

-- Create dedicated sentinel_travel_data table
create table if not exists public.sentinel_travel_data (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  travel_destination text,
  travel_method text,
  travel_departed_at timestamptz,
  travel_arrival_at timestamptz,
  travel_time_left integer,
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

-- Rename user_worker_schedules to sentinel_user_worker_schedules
alter table if exists public.user_worker_schedules
  rename to sentinel_user_worker_schedules;

-- Disable RLS on sentinel_user_worker_schedules (worker-internal only)
alter table public.sentinel_user_worker_schedules
  disable row level security;

-- Update indexes
drop index if exists user_worker_schedules_user_worker_idx;
drop index if exists user_worker_schedules_next_run_idx;

create unique index if not exists sentinel_user_worker_schedules_user_worker_idx
  on public.sentinel_user_worker_schedules (user_id, worker);

create index if not exists sentinel_user_worker_schedules_next_run_idx
  on public.sentinel_user_worker_schedules (next_run_at);
