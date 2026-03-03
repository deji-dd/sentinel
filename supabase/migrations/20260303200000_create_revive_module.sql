-- Create revive module config table (per guild)
create table if not exists sentinel_revive_config (
  guild_id text primary key,
  request_channel_id text,
  requests_output_channel_id text,
  min_hospital_seconds_left integer not null default 0,
  request_message_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Create revive requests table (one active request per user per guild)
create table if not exists sentinel_revive_requests (
  id bigint primary key generated always as identity,
  guild_id text not null,
  requester_discord_id text not null,
  request_channel_id text,
  request_message_id text,
  requester_torn_id integer,
  requester_torn_name text,
  revivable boolean,
  status_description text,
  status_details text,
  status_state text,
  hospital_until integer,
  hospital_seconds_left integer,
  faction_id integer,
  last_action_status text,
  last_action_relative text,
  last_action_timestamp integer,
  state text not null default 'active',
  expires_at timestamp with time zone not null default (now() + interval '5 minutes'),
  completed_by_discord_id text,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint revive_request_state_check check (state in ('active', 'completed', 'cancelled', 'expired'))
);

-- Enforce a single active request per user per guild
create unique index if not exists idx_revive_requests_unique_active
  on sentinel_revive_requests (guild_id, requester_discord_id)
  where state = 'active';

create index if not exists idx_revive_requests_guild_state
  on sentinel_revive_requests (guild_id, state, expires_at);

create index if not exists idx_revive_requests_created_at
  on sentinel_revive_requests (created_at desc);
