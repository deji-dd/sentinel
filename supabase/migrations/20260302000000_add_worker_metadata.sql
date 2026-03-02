-- Add metadata column to sentinel_worker_schedules for storing worker state
-- Used for optimizations like response hash caching, consecutive no-change runs, etc.

alter table sentinel_worker_schedules 
  add column if not exists metadata jsonb default '{}'::jsonb;

-- Add index for faster metadata queries
create index if not exists idx_worker_schedules_metadata 
  on sentinel_worker_schedules using gin (metadata);

comment on column sentinel_worker_schedules.metadata is 'Worker-specific metadata for optimizations (e.g., response_hash, consecutive_no_change_runs)';
