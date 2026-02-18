-- Create sentinel_guild_modules table for Discord guild configuration
create table sentinel_guild_modules (
  guild_id text primary key,
  enabled_modules text[] default '{}',
  admin_role_ids text[] default '{}',
  verified_role_ids text[] default '{}',
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Grant permissions
grant all on table sentinel_guild_modules to anon;
grant all on table sentinel_guild_modules to authenticated;
grant all on table sentinel_guild_modules to service_role;
