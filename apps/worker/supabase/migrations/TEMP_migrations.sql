-- TEMP_migrations.sql
-- Apply with: psql "$SUPABASE_DB_URL" -f apps/worker/supabase/migrations/TEMP_migrations.sql
-- Purpose: latest incremental changes only

-- Drop player_id and name from sentinel_users (moved to sentinel_user_data)
alter table public.sentinel_users 
  drop column if exists player_id,
  drop column if exists name;

drop index if exists public.sentinel_users_player_id_idx;

-- Add discord_id to sentinel_user_data
alter table public.sentinel_user_data
  add column if not exists discord_id text unique;

create index if not exists sentinel_user_data_discord_id_idx
  on public.sentinel_user_data (discord_id)
  where discord_id is not null;

-- Add rate limit state tracking columns to sentinel_worker_logs
alter table public.sentinel_worker_logs
  add column if not exists is_limited boolean default false;

alter table public.sentinel_worker_logs
  add column if not exists limited_until timestamptz;

alter table public.sentinel_worker_logs
  add column if not exists last_error_at timestamptz;

-- Create table for rate limit request tracking (survives restarts)
create table if not exists public.sentinel_rate_limit_requests (
  id bigserial primary key,
  requested_at timestamptz not null default now()
);

create index if not exists sentinel_rate_limit_requests_requested_at_idx
  on public.sentinel_rate_limit_requests (requested_at desc);

-- Enable RLS
alter table public.sentinel_rate_limit_requests enable row level security;

-- Service role policy
drop policy if exists sentinel_rate_limit_requests_service_role on public.sentinel_rate_limit_requests;
create policy sentinel_rate_limit_requests_service_role on public.sentinel_rate_limit_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Final schema refresh
notify pgrst, 'reload schema';
