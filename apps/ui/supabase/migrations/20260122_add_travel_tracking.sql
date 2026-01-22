-- Travel tracking fields and per-worker scheduling metadata
create extension if not exists "pgcrypto";

alter table if exists public.user_data
  add column if not exists travel_destination text,
  add column if not exists travel_method text,
  add column if not exists travel_departed_at timestamptz,
  add column if not exists travel_arrival_at timestamptz,
  add column if not exists travel_time_left integer;

create table if not exists public.user_worker_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  worker text not null,
  next_run_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_worker_schedules_user_worker_idx
  on public.user_worker_schedules (user_id, worker);

create index if not exists user_worker_schedules_next_run_idx
  on public.user_worker_schedules (next_run_at);

create or replace function public.user_worker_schedules_update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_worker_schedules_set_updated_at on public.user_worker_schedules;
create trigger user_worker_schedules_set_updated_at
before update on public.user_worker_schedules
for each row
execute procedure public.user_worker_schedules_update_timestamp();
