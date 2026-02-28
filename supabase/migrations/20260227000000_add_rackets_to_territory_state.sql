-- Add racket tracking columns to sentinel_territory_state
-- Rackets spawn on territories and can change levels or disappear
alter table sentinel_territory_state
  add column if not exists racket_name text,
  add column if not exists racket_level integer,
  add column if not exists racket_reward text,
  add column if not exists racket_created_at integer,
  add column if not exists racket_changed_at integer;

-- Create index for racket queries
create index if not exists idx_territory_state_has_racket 
  on sentinel_territory_state(territory_id) 
  where racket_name is not null;

comment on column sentinel_territory_state.racket_name is 'Name of racket currently on this territory (e.g., "Bootleg Distillery V")';
comment on column sentinel_territory_state.racket_level is 'Level of racket (1-5)';
comment on column sentinel_territory_state.racket_reward is 'Description of daily reward from racket';
comment on column sentinel_territory_state.racket_created_at is 'Unix timestamp when racket was first created on this territory';
comment on column sentinel_territory_state.racket_changed_at is 'Unix timestamp when racket was last modified (level change)';
