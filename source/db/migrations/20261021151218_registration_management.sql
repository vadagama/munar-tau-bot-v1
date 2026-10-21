-- REG-01/02, PRV-02, ADR-016: одна основная анкета, проверяемые исправления.
alter table registration add column if not exists version integer not null default 1;
alter table registration add column if not exists confirmed_draft jsonb;
alter table registration add column if not exists reactivating boolean not null default false;
alter table registration add column if not exists superseded_by uuid references registration(id);

-- Сохраняем все исторические записи. Не сливаем анкеты разных подтверждённых людей.
do $$ begin
  if exists (
    select telegram_user_id from registration
    where premises_id is null and telegram_user_id is not null and state='approved' and superseded_by is null
    group by telegram_user_id having count(distinct person_id)>1
  ) then raise exception 'Основные анкеты Telegram связаны с разными людьми: требуется ручной разбор'; end if;
end $$;
with ranked as (
  select id, first_value(id) over (
    partition by telegram_user_id order by (state='approved') desc, created_at desc, id
  ) as primary_id
  from registration where premises_id is null and telegram_user_id is not null
    and state<>'withdrawn' and superseded_by is null
)
update registration r set superseded_by=ranked.primary_id
from ranked where r.id=ranked.id and ranked.id<>ranked.primary_id;
update timer set state='canceled' where state='pending'
  and entity_id in (select id from registration where superseded_by is not null);
create unique index if not exists registration_primary_telegram_uq on registration(telegram_user_id)
  where premises_id is null and telegram_user_id is not null and state<>'withdrawn' and superseded_by is null;

create or replace function bump_registration_version() returns trigger language plpgsql as $$
begin new.version=old.version+1; new.updated_at=clock_timestamp(); return new; end $$;
drop trigger if exists registration_version on registration;
create trigger registration_version before update on registration
  for each row execute function bump_registration_version();
revoke all on function bump_registration_version() from public, anon, authenticated;
