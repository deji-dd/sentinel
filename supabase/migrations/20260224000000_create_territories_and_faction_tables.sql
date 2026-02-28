-- Create sentinel_territory_blueprint table for static territory geography
-- Based on /torn/territory API endpoint
create table sentinel_territory_blueprint (
  id text primary key,
  sector integer not null,
  size integer not null,
  density integer not null,
  slots integer not null,
  respect integer not null,
  coordinate_x float not null,
  coordinate_y float not null,
  neighbors text[] not null default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create sentinel_territory_state table for live territory ownership
create table sentinel_territory_state (
  territory_id text primary key references sentinel_territory_blueprint(id) on delete cascade,
  faction_id integer,
  is_warring boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create sentinel_war_ledger table for territory war combat history
create table sentinel_war_ledger (
  war_id integer primary key,
  territory_id text not null references sentinel_territory_blueprint(id) on delete restrict,
  assaulting_faction integer not null,
  defending_faction integer not null,
  victor_faction integer,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create sentinel_torn_factions table for cached faction data
-- Based on /faction/{id}/basic API endpoint
create table sentinel_torn_factions (
  id integer primary key,
  name text not null,
  tag text not null,
  tag_image text,
  leader_id integer,
  co_leader_id integer,
  respect integer not null,
  days_old integer,
  capacity integer not null,
  members integer not null,
  is_enlisted boolean,
  rank text,
  best_chain integer,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create indexes for common queries
create index idx_territory_blueprint_sector on sentinel_territory_blueprint(sector);
create index idx_territory_state_faction_id on sentinel_territory_state(faction_id);
create index idx_territory_state_is_warring on sentinel_territory_state(is_warring) where is_warring = true;
create index idx_war_ledger_territory_id on sentinel_war_ledger(territory_id);
create index idx_war_ledger_assaulting_faction on sentinel_war_ledger(assaulting_faction);
create index idx_war_ledger_defending_faction on sentinel_war_ledger(defending_faction);
create index idx_war_ledger_victor_faction on sentinel_war_ledger(victor_faction);
create index idx_war_ledger_start_time on sentinel_war_ledger(start_time desc);
create index idx_torn_factions_name on sentinel_torn_factions(name);
create index idx_torn_factions_tag on sentinel_torn_factions(tag);
create index idx_torn_factions_updated_at on sentinel_torn_factions(updated_at desc);

-- Enable RLS but allow service_role to manage all data
alter table sentinel_territory_blueprint enable row level security;
alter table sentinel_territory_state enable row level security;
alter table sentinel_war_ledger enable row level security;
alter table sentinel_torn_factions enable row level security;

-- RLS policies: service_role can do everything, others can only read
create policy "service_role manages territories"
  on sentinel_territory_blueprint
  for all
  to service_role
  using (true)
  with check (true);

create policy "public reads territories"
  on sentinel_territory_blueprint
  for select
  to public
  using (true);

create policy "service_role manages territory state"
  on sentinel_territory_state
  for all
  to service_role
  using (true)
  with check (true);

create policy "public reads territory state"
  on sentinel_territory_state
  for select
  to public
  using (true);

create policy "service_role manages war ledger"
  on sentinel_war_ledger
  for all
  to service_role
  using (true)
  with check (true);

create policy "public reads war ledger"
  on sentinel_war_ledger
  for select
  to public
  using (true);

create policy "service_role manages factions"
  on sentinel_torn_factions
  for all
  to service_role
  using (true)
  with check (true);

create policy "public reads factions"
  on sentinel_torn_factions
  for select
  to public
  using (true);

-- Grant permissions
grant all on table sentinel_territory_blueprint to service_role;
grant select on table sentinel_territory_blueprint to anon, authenticated;

grant all on table sentinel_territory_state to service_role;
grant select on table sentinel_territory_state to anon, authenticated;

grant all on table sentinel_war_ledger to service_role;
grant select on table sentinel_war_ledger to anon, authenticated;

grant all on table sentinel_torn_factions to service_role;
grant select on table sentinel_torn_factions to anon, authenticated;
