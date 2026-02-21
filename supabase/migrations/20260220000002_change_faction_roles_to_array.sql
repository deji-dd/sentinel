-- Change role_id to role_ids array to support multiple roles per faction
alter table sentinel_faction_roles 
  drop column role_id,
  add column role_ids text[] not null default '{}';

-- Update column comment
comment on column sentinel_faction_roles.role_ids is 'Array of Discord role IDs for this faction';
