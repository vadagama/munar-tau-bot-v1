alter table attachment drop constraint if exists attachment_owner_type_check;
alter table attachment add constraint attachment_owner_type_check check(owner_type in ('message','request','task','document'));
alter table attachment drop constraint if exists attachment_task_owner_check;
alter table attachment add constraint attachment_task_owner_check check(
 (owner_type='task' and task_id is not null and owner_id=task_id and request_id is null and bucket='internal') or
 (owner_type='document' and task_id is null and task_report_id is null and request_id is null) or
 (owner_type in ('request','message') and task_id is null and task_report_id is null and request_id is not null));
create or replace function protect_document_attachment() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.owner_type='document' and exists(select 1 from document_version where attachment_id=old.id or signed_attachment_id=old.id) then
  raise exception 'document attachment is immutable';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists document_attachment_immutable on attachment;
create trigger document_attachment_immutable before update or delete on attachment for each row execute function protect_document_attachment();
revoke execute on function protect_document_attachment() from public,anon,authenticated;
