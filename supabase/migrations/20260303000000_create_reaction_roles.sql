-- Create reaction roles table for storing emoji-to-role mappings
create table if not exists sentinel_reaction_roles (
  id bigint primary key generated always as identity,
  guild_id text not null,
  message_id text not null,
  emoji text not null,
  role_id text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  -- Ensure one emoji per message per guild
  unique(guild_id, message_id, emoji)
);

-- Create indexes for efficient lookups
create index if not exists idx_reaction_roles_guild_id on sentinel_reaction_roles(guild_id);
create index if not exists idx_reaction_roles_message_id on sentinel_reaction_roles(message_id);
create index if not exists idx_reaction_roles_guild_message on sentinel_reaction_roles(guild_id, message_id);

-- Create reaction role configs table for managing settings per guild
create table if not exists sentinel_reaction_role_config (
  guild_id text primary key,
  allowed_role_ids text[] default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
