alter table if exists sentinel_revive_config
add column if not exists ping_role_id text;
