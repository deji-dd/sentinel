-- Rename sentinel_guild_modules to sentinel_guild_config and add API key column
-- First, drop the foreign key constraint in sentinel_faction_roles
alter table sentinel_faction_roles
  drop constraint fk_guild_id;

-- Rename the table
alter table sentinel_guild_modules
  rename to sentinel_guild_config;

-- Add encrypted API key column
alter table sentinel_guild_config
  add column api_key text,
  add column nickname_template text default '{name}#{id}';

-- Re-create the foreign key constraint with the new table name
alter table sentinel_faction_roles
  add constraint fk_guild_id foreign key (guild_id) 
  references sentinel_guild_config(guild_id) on delete cascade;

-- Update permissions
grant all on table sentinel_guild_config to anon;
grant all on table sentinel_guild_config to authenticated;
grant all on table sentinel_guild_config to service_role;
