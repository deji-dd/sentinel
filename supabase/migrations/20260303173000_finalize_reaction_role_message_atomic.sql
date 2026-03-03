-- Make reaction role FK deferrable so message ID finalization can happen atomically
alter table sentinel_reaction_role_mappings
  drop constraint if exists fk_message_id;

alter table sentinel_reaction_role_mappings
  add constraint fk_message_id
  foreign key (message_id)
  references sentinel_reaction_role_messages(message_id)
  on delete cascade
  deferrable initially immediate;

-- Finalize pending reaction role message IDs in a single transaction
create or replace function sentinel_finalize_reaction_role_message(
  p_record_id bigint,
  p_new_message_id text
)
returns table(updated_message_rows integer, updated_mapping_rows integer)
language plpgsql
as $$
declare
  v_old_message_id text;
  v_updated_message_rows integer := 0;
  v_updated_mapping_rows integer := 0;
begin
  set constraints fk_message_id deferred;

  select message_id
  into v_old_message_id
  from sentinel_reaction_role_messages
  where id = p_record_id
  for update;

  if v_old_message_id is null then
    raise exception 'Reaction role message record not found for id=%', p_record_id;
  end if;

  update sentinel_reaction_role_mappings
  set message_id = p_new_message_id
  where message_id = v_old_message_id;

  get diagnostics v_updated_mapping_rows = row_count;

  update sentinel_reaction_role_messages
  set message_id = p_new_message_id,
      updated_at = now()
  where id = p_record_id;

  get diagnostics v_updated_message_rows = row_count;

  return query
  select v_updated_message_rows, v_updated_mapping_rows;
end;
$$;