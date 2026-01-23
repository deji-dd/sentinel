-- TEMP_migrations.sql
-- - Added travel benefit tracking columns (has_airstrip, has_wlt_benefit, active_travel_book)
-- - Removed capacity_manually_set (now using v1 API to detect manual edits)
-- - Changed capacity default from 0 to 5

-- Add travel benefit columns
alter table public.sentinel_travel_data
  add column if not exists has_airstrip boolean not null default false,
  add column if not exists has_wlt_benefit boolean not null default false,
  add column if not exists active_travel_book boolean not null default false;

-- Remove capacity_manually_set column
alter table public.sentinel_travel_data
  drop column if exists capacity_manually_set;

-- Update capacity default
alter table public.sentinel_travel_data
  alter column capacity set default 5;

-- Drop the old RPC function (no longer needed without capacity_manually_set)
drop function if exists public.set_user_travel_capacity(integer);
