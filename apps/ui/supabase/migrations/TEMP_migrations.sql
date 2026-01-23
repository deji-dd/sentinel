-- TEMP_migrations.sql
-- Personal temporary migration file for schema changes.
-- This file gets overwritten with each new change.
-- Apply with: psql "$SUPABASE_DB_URL" -f apps/ui/supabase/migrations/TEMP_migrations.sql
--
-- Current changes:
-- - Added capacity_manually_set column to sentinel_travel_data
-- - Changed capacity default from 0 to 5
-- - Added set_user_travel_capacity RPC function

-- Add capacity_manually_set column if it doesn't exist
alter table public.sentinel_travel_data
  add column if not exists capacity_manually_set boolean not null default false;

-- Update capacity default (safe for existing rows)
alter table public.sentinel_travel_data
  alter column capacity set default 5;

-- Create or replace the RPC to allow users to set their travel capacity
create or replace function public.set_user_travel_capacity(capacity_value integer)
returns void as $$
begin
  update public.sentinel_travel_data
  set capacity = capacity_value,
      capacity_manually_set = true,
      updated_at = now()
  where user_id = auth.uid()::text;
end;
$$ language plpgsql security definer set search_path = public;
