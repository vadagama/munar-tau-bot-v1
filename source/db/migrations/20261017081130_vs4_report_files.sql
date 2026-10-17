alter table task add column if not exists rework_due_at timestamptz;
-- WRK-16: вложения задания не раскрывают переписку обращения.
alter table attachment alter column request_id drop not null;
alter table attachment add column if not exists task_id uuid references task(id);
alter table attachment add column if not exists task_report_id uuid references task_report(id);
alter table attachment drop constraint if exists attachment_owner_type_check;
alter table attachment add constraint attachment_owner_type_check check(owner_type in ('message','request','task'));
alter table attachment drop constraint if exists attachment_task_owner_check;
alter table attachment add constraint attachment_task_owner_check check(
 (owner_type='task' and task_id is not null and owner_id=task_id and request_id is null and bucket='internal') or
 (owner_type<>'task' and task_id is null and task_report_id is null and request_id is not null));
create index if not exists attachment_task on attachment(task_id);
create index if not exists attachment_task_report on attachment(task_report_id);
create or replace function protect_task_attachment() returns trigger language plpgsql as $$
begin
 if old.task_report_id is not null then
   raise exception 'report attachment is immutable';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists task_attachment_immutable on attachment;
create trigger task_attachment_immutable before update or delete on attachment for each row execute function protect_task_attachment();
