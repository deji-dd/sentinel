-- Create guild audit log table
create table if not exists sentinel_guild_audit (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  actor_discord_id text not null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sentinel_guild_audit_guild_id
  on sentinel_guild_audit (guild_id);

create index if not exists idx_sentinel_guild_audit_created_at
  on sentinel_guild_audit (created_at);

grant all on table sentinel_guild_audit to anon;
grant all on table sentinel_guild_audit to authenticated;
grant all on table sentinel_guild_audit to service_role;
