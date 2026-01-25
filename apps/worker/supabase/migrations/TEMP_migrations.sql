-- TEMP_migrations.sql
-- Apply with: psql "$SUPABASE_DB_URL" -f apps/worker/supabase/migrations/TEMP_migrations.sql
-- Purpose: latest incremental changes only

-- Fix sentinel_travel_data: make user_id primary key, drop id column
-- Drop the id column and its default, make user_id the primary key
alter table public.sentinel_travel_data
  drop column id;

alter table public.sentinel_travel_data
  add constraint sentinel_travel_data_pkey primary key (user_id);

-- Drop the now-redundant unique constraint on user_id
alter table public.sentinel_travel_data
  drop constraint if exists sentinel_travel_data_user_id_key;

-- Drop the old index on user_id since it's now the primary key
drop index if exists public.sentinel_travel_data_user_id_idx;

-- Add foreign key constraint from sentinel_travel_stock_cache.item_id to sentinel_torn_items.item_id
alter table public.sentinel_travel_stock_cache
  add constraint sentinel_travel_stock_cache_item_id_fkey
  foreign key (item_id) references public.sentinel_torn_items(item_id) on delete cascade;
