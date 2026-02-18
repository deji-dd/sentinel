-- Create sentinel_verified_users table for Discord user / Torn player verification
create table sentinel_verified_users (
  discord_id text primary key,
  torn_id integer not null unique,
  torn_name text not null,
  faction_id integer,
  faction_tag text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Create index on torn_id for quick lookups
create index idx_verified_users_torn_id on sentinel_verified_users(torn_id);

-- Grant permissions
grant all on table sentinel_verified_users to anon;
grant all on table sentinel_verified_users to authenticated;
grant all on table sentinel_verified_users to service_role;
