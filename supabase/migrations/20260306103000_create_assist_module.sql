-- Assist module configuration per guild
create table if not exists sentinel_assist_config (
  guild_id text primary key,
  assist_channel_id text,
  ping_role_id text,
  is_active boolean not null default true,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Authorized assist tokens used by external assist scripts
create table if not exists sentinel_assist_tokens (
  id bigint primary key generated always as identity,
  guild_id text not null,
  discord_id text not null,
  torn_id integer not null,
  token_uuid uuid not null unique,
  label text,
  strike_count integer not null default 0,
  is_active boolean not null default true,
  blacklisted_at timestamp with time zone,
  blacklisted_reason text,
  expires_at timestamp with time zone,
  last_used_at timestamp with time zone,
  last_seen_ip text,
  last_seen_user_agent text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint assist_tokens_strike_count_check check (strike_count >= 0)
);

create index if not exists idx_assist_tokens_guild_active
  on sentinel_assist_tokens (guild_id, is_active);

create index if not exists idx_assist_tokens_discord
  on sentinel_assist_tokens (discord_id);

create index if not exists idx_assist_tokens_torn
  on sentinel_assist_tokens (torn_id);
