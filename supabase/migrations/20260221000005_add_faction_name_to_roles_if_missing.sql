-- Backfill migration for cloud: ensure faction_name exists on sentinel_faction_roles
alter table sentinel_faction_roles
  add column if not exists faction_name text;

create index if not exists idx_faction_roles_faction_name
  on sentinel_faction_roles(faction_name);
