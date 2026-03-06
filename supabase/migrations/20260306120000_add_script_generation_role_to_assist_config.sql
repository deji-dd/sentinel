-- Add script_generation_role_ids to assist_config table
alter table sentinel_assist_config 
  add column if not exists script_generation_role_ids text[] default array[]::text[] not null;

comment on column sentinel_assist_config.script_generation_role_ids is 
  'Role IDs that are allowed to generate assist script installation URLs';
