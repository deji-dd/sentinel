-- Create sentinel_faction_roles table for guild-specific faction role mappings
create table sentinel_faction_roles (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  faction_id integer not null,
  role_id text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  
  -- Foreign key constraint to guild_modules
  constraint fk_guild_id foreign key (guild_id) references sentinel_guild_modules(guild_id) on delete cascade,
  
  -- Unique constraint on guild_id and faction_id combination
  constraint unique_guild_faction unique (guild_id, faction_id)
);

-- Create index on guild_id for quick lookups
create index idx_faction_roles_guild_id on sentinel_faction_roles(guild_id);

-- Create index on faction_id for quick lookups
create index idx_faction_roles_faction_id on sentinel_faction_roles(faction_id);

-- Grant permissions
grant all on table sentinel_faction_roles to anon;
grant all on table sentinel_faction_roles to authenticated;
grant all on table sentinel_faction_roles to service_role;
