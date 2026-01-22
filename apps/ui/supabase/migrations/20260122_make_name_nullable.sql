-- Make sentinel_users.name nullable (populated by sync worker on first run)

alter table public.sentinel_users
  alter column name drop not null;
