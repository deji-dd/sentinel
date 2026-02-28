-- Enhance sentinel_faction_roles for improved faction role management
-- Adds support for separate leader roles and enable/disable toggle

-- Add new columns
alter table sentinel_faction_roles 
  add column if not exists enabled boolean not null default true,
  add column if not exists leader_role_ids text[] not null default '{}';

-- Rename role_ids to member_role_ids for clarity
-- (member_role_ids = roles assigned to ALL faction members)
-- (leader_role_ids = roles assigned ONLY to leaders/co-leaders)
alter table sentinel_faction_roles 
  rename column role_ids to member_role_ids;

-- Add column comments for documentation
comment on column sentinel_faction_roles.enabled is 'Whether this faction role mapping is active';
comment on column sentinel_faction_roles.member_role_ids is 'Discord role IDs assigned to ALL members of this faction';
comment on column sentinel_faction_roles.leader_role_ids is 'Discord role IDs assigned ONLY to faction leaders and co-leaders';

-- Create index on enabled for efficient filtering
create index if not exists idx_faction_roles_enabled on sentinel_faction_roles(enabled);

