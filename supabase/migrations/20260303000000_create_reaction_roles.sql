-- Create reaction role messages table for tracking bot-posted messages
create table if not exists sentinel_reaction_role_messages (
  id bigint primary key generated always as identity,
  guild_id text not null,
  channel_id text not null,
  message_id text not null unique,
  title text not null,
  description text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create reaction role mappings table for emoji-to-role associations
create table if not exists sentinel_reaction_role_mappings (
  id bigint primary key generated always as identity,
  message_id text not null,
  emoji text not null,
  role_id text not null,
  created_at timestamp with time zone default now(),
  
  -- Ensure one emoji per message
  unique(message_id, emoji),
  -- Foreign key reference
  constraint fk_message_id foreign key (message_id) references sentinel_reaction_role_messages(message_id) on delete cascade
);

-- Create reaction role configs table for managing settings per guild
create table if not exists sentinel_reaction_role_config (
  guild_id text primary key,
  allowed_role_ids text[] default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create indexes for efficient lookups
create index if not exists idx_reaction_role_messages_guild on sentinel_reaction_role_messages(guild_id);
create index if not exists idx_reaction_role_messages_channel on sentinel_reaction_role_messages(channel_id);
create index if not exists idx_reaction_role_mappings_message on sentinel_reaction_role_mappings(message_id);
