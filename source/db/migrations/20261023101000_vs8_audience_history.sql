-- POL-02/03: закрытая история аудитории; прошлое до внедрения не восстанавливаем.
-- Serialize replay before acquiring any table DDL lock.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.audience_history_meta (
  singleton boolean primary key default true check (singleton),
  starts_at timestamptz not null default clock_timestamp()
);
insert into public.audience_history_meta(singleton) values(true) on conflict do nothing;
create table if not exists public.audience_connection_event (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  person_id uuid not null,
  premises_id uuid not null,
  building_id uuid not null,
  is_test boolean not null,
  enabled boolean not null,
  effective_at timestamptz not null,
  valid_from timestamptz,
  valid_until timestamptz
);
create index if not exists audience_connection_event_link on public.audience_connection_event(connection_id,effective_at,id);
create index if not exists audience_connection_event_person on public.audience_connection_event(person_id,effective_at);
alter table public.audience_history_meta enable row level security;
alter table public.audience_connection_event enable row level security;
revoke all on public.audience_history_meta, public.audience_connection_event from public,anon,authenticated;

-- Root transaction MUST call this before taking any row lock (ADR-019).
create or replace function public.audience_clock() returns timestamptz
language plpgsql set search_path=pg_catalog,public as $$
declare stamp text;
begin
  perform pg_advisory_xact_lock(814733,8);
  stamp := current_setting('osi.audience_at',true);
  if stamp is null or stamp='' then
    stamp := clock_timestamp()::text;
    perform set_config('osi.audience_at',stamp,true);
  end if;
  return stamp::timestamptz;
end $$;

-- Before any eligibility-table DDL locks, including migration replay.
select public.audience_clock();

create or replace function public.audience_capture(link_id uuid, force_disabled boolean default false)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare stamp timestamptz := public.audience_clock();
begin
  insert into public.audience_connection_event(connection_id,person_id,premises_id,building_id,is_test,enabled,effective_at,valid_from,valid_until)
  select c.id,c.person_id,c.premises_id,m.building_id,p.is_test,
    not force_disabled and c.status='active' and p.status='active' and m.status='active'
      and m.is_test=p.is_test and exists(select 1 from public.profile f where f.person_id=p.id and f.archived_at is null and f.is_test=p.is_test),
    stamp, c.start_date::timestamp at time zone 'Asia/Almaty',
    (c.end_date+1)::timestamp at time zone 'Asia/Almaty'
  from public.connection c join public.person p on p.id=c.person_id join public.premises m on m.id=c.premises_id
  where c.id=link_id;
  if not found then
    -- Родитель при каскадном DELETE уже может отсутствовать: сохраняем последний адрес.
    insert into public.audience_connection_event(connection_id,person_id,premises_id,building_id,is_test,enabled,effective_at,valid_from,valid_until)
    select connection_id,person_id,premises_id,building_id,is_test,false,stamp,valid_from,valid_until
    from public.audience_connection_event where connection_id=link_id order by effective_at desc,id desc limit 1;
  end if;
end $$;

create or replace function public.audience_statement_gate() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin perform public.audience_clock(); return null; end $$;

create or replace function public.audience_connection_capture() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='DELETE' then perform public.audience_capture(old.id,true); return old; end if;
  perform public.audience_capture(new.id); return new;
end $$;
create or replace function public.audience_parent_capture() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare item record; target uuid;
begin
  if TG_OP='DELETE' then target:=old.id; else target:=new.id; end if;
  if TG_TABLE_NAME='profile' then
    if TG_OP='DELETE' then target:=old.person_id; else target:=new.person_id; end if;
  end if;
  for item in select c.id from public.connection c where
    (TG_TABLE_NAME='premises' and c.premises_id=target) or
    (TG_TABLE_NAME in ('person','profile') and c.person_id=target)
  loop perform public.audience_capture(item.id,TG_OP='DELETE' and TG_TABLE_NAME<>'profile'); end loop;
  if TG_TABLE_NAME='profile' then
    if TG_OP='UPDATE' then
      if old.person_id<>new.person_id then
        for item in select id from public.connection where person_id=old.person_id
        loop perform public.audience_capture(item.id); end loop;
      end if;
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;

-- BEFORE STATEMENT protects ordinary raw DML too. Explicit pre-locks still require
-- audience_clock first; a row trigger alone would invert the lock order.
do $$ declare tbl text; cols text; begin
  foreach tbl in array array['connection','premises','person','profile','building'] loop
    cols:=case tbl when 'connection' then 'person_id,premises_id,status,start_date,end_date'
      when 'premises' then 'building_id,status,is_test' when 'person' then 'status,is_test'
      when 'profile' then 'person_id,is_test,archived_at' else null end;
    execute format('drop trigger if exists audience_gate on public.%I',tbl);
    execute format('create trigger audience_gate before insert or delete on public.%I for each statement execute function public.audience_statement_gate()',tbl);
    execute format('drop trigger if exists audience_gate_update on public.%I',tbl);
    if cols is not null then
      execute format('create trigger audience_gate_update before update of %s on public.%I for each statement execute function public.audience_statement_gate()',cols,tbl);
    end if;
  end loop;
end $$;
drop trigger if exists audience_capture_change on public.connection;
create trigger audience_capture_change after insert or update of person_id,premises_id,status,start_date,end_date on public.connection for each row execute function public.audience_connection_capture();
drop trigger if exists audience_capture_delete on public.connection;
create trigger audience_capture_delete before delete on public.connection for each row execute function public.audience_connection_capture();
do $$ declare tbl text; cols text; begin
  foreach tbl in array array['premises','person','profile'] loop
    cols:=case tbl when 'premises' then 'building_id,status,is_test' when 'person' then 'status,is_test' else 'person_id,is_test,archived_at' end;
    execute format('drop trigger if exists audience_capture_change on public.%I',tbl);
    execute format('create trigger audience_capture_change after insert or update of %s on public.%I for each row execute function public.audience_parent_capture()',cols,tbl);
    execute format('drop trigger if exists audience_capture_delete on public.%I',tbl);
    if tbl='profile' then
      execute format('create trigger audience_capture_delete after delete on public.%I for each row execute function public.audience_parent_capture()',tbl);
    else
      execute format('create trigger audience_capture_delete before delete on public.%I for each row execute function public.audience_parent_capture()',tbl);
    end if;
  end loop;
end $$;

-- Один снимок существующих связей, только с момента запуска истории.
do $$ declare item record; begin
  perform public.audience_clock();
  for item in select id from public.connection c where not exists(select 1 from public.audience_connection_event e where e.connection_id=c.id)
  loop perform public.audience_capture(item.id); end loop;
end $$;
create or replace function public.audience_history_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'Audience history is append-only' using errcode='42501'; end $$;
drop trigger if exists audience_history_immutable on public.audience_connection_event;
create trigger audience_history_immutable before update or delete on public.audience_connection_event for each statement execute function public.audience_history_immutable();
revoke all on function public.audience_clock(), public.audience_capture(uuid,boolean), public.audience_statement_gate(), public.audience_connection_capture(), public.audience_parent_capture(), public.audience_history_immutable() from public,anon,authenticated;
grant execute on function public.audience_clock() to service_role;
