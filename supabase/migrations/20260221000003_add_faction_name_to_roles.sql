-- Add faction_name column to cache faction names
alter table sentinel_faction_roles 
  add column faction_name text;

-- Add index for consistency
create index idx_faction_roles_faction_name on sentinel_faction_roles(faction_name);
