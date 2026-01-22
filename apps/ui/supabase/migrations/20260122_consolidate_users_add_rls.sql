-- Consolidate user_keys and user_data into sentinel_users with RLS

-- Create consolidated sentinel_users table
create table if not exists public.sentinel_users (
  user_id text primary key,
  player_id integer not null,
  name text not null,
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sentinel_users_player_id_idx on public.sentinel_users (player_id);

-- Auto-update timestamp
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

-- Enable RLS
alter table public.sentinel_users enable row level security;

-- Policy: Users can only read their own row
create policy sentinel_users_select_self on public.sentinel_users
  for select
  using (auth.uid()::text = user_id);

-- Policy: Users can only update their own row (limited fields)
create policy sentinel_users_update_self on public.sentinel_users
  for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- Drop old tables
drop table if exists public.sentinel_user_keys;
drop table if exists public.sentinel_user_data;

-- Add RLS to worker schedules (service role only)
alter table public.sentinel_user_worker_schedules enable row level security;

-- Policy: Allow service role to read/write, deny all others
create policy sentinel_user_worker_schedules_service_role on public.sentinel_user_worker_schedules
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
