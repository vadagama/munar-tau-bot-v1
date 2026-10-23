-- POL-01–04. Прикладной доступ только через общий домен/PDP.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.poll (
 id uuid primary key default gen_random_uuid(),
 question text not null check(length(btrim(question)) between 1 and 2000),
 options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 20),
 building_ids uuid[] not null check(cardinality(building_ids) between 1 and 100),
 closes_at timestamptz not null,
 state text not null default 'draft' check(state in ('draft','open','closed','canceled')),
 is_test boolean not null,
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.person(id),
 created_at timestamptz not null default clock_timestamp(),
 opened_at timestamptz,
 closed_at timestamptz,
 canceled_at timestamptz,
 cancel_reason text,
 check(state='draft' or opened_at is not null),
 check(opened_at is null or closes_at>opened_at),
 check((state='canceled')=(canceled_at is not null)),
 check(state<>'canceled' or coalesce(length(btrim(cancel_reason)),0)>0),
 check((state='closed')=(closed_at is not null))
);
create index if not exists poll_open_due on public.poll(closes_at,id) where state='open';
create index if not exists poll_mode_created on public.poll(is_test,created_at desc,id);
create table if not exists public.poll_answer (
 poll_id uuid not null references public.poll(id),
 person_id uuid not null references public.person(id),
 option_key text not null,
 version integer not null check(version>0),
 answered_at timestamptz not null,
 excluded_at timestamptz,
 primary key(poll_id,person_id)
);
create table if not exists public.poll_answer_log (
 id bigint generated always as identity primary key,
 poll_id uuid not null references public.poll(id),
 person_id uuid not null references public.person(id),
 answer_version integer not null,
 action text not null check(action in ('answer','excluded')),
 option_key text,
 at timestamptz not null,
 check((action='answer')=(option_key is not null))
);
create index if not exists poll_answer_log_person on public.poll_answer_log(poll_id,person_id,id);
create unique index if not exists poll_answer_log_exclusion on public.poll_answer_log(poll_id,person_id,answer_version) where action='excluded';

create or replace function public.poll_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare item jsonb; keys text[]:='{}';
begin
 for item in select value from jsonb_array_elements(new.options) loop
   if jsonb_typeof(item)<>'object' or coalesce(item->>'key','')!~'^[a-zA-Z0-9_-]{1,64}$' or
      jsonb_typeof(item->'key')<>'string' or jsonb_typeof(item->'label')<>'string' or
      coalesce(length(btrim(item->>'label')),0) not between 1 and 300 or (item->>'key')=any(keys) then
     raise exception 'Invalid poll options' using errcode='23514';
   end if;
   keys:=array_append(keys,item->>'key');
 end loop;
 if array_position(new.building_ids,null) is not null or cardinality(new.building_ids)<>(select count(distinct id) from unnest(new.building_ids) id) then
   raise exception 'Invalid poll scope' using errcode='23514';
 end if;
 if TG_OP='INSERT' then
   if new.state<>'draft' then raise exception 'Poll starts as draft' using errcode='23514'; end if;
 else
   if old.state<>'draft' and (new.question,new.options,new.building_ids,new.closes_at,new.is_test,new.opened_at) is distinct from
      (old.question,old.options,old.building_ids,old.closes_at,old.is_test,old.opened_at) then
     raise exception 'Opened poll is immutable' using errcode='23514';
   end if;
   if new.state<>old.state and not ((old.state='draft' and new.state='open') or (old.state='open' and new.state in ('closed','canceled'))) then
     raise exception 'Invalid poll transition' using errcode='23514';
   end if;
   if old.state in ('closed','canceled') then raise exception 'Final poll is immutable' using errcode='23514'; end if;
   if new.version<>old.version+1 then raise exception 'Poll version must advance' using errcode='23514'; end if;
 end if;
 return new;
end $$;
drop trigger if exists poll_guard on public.poll;
create trigger poll_guard before insert or update on public.poll for each row execute function public.poll_guard();
create or replace function public.poll_answer_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare p public.poll; stamp timestamptz:=clock_timestamp(); local_day date := (stamp at time zone 'Asia/Almaty')::date;
begin
 select * into p from public.poll where id=new.poll_id;
 if not found or p.state<>'open' or stamp>=p.closes_at then
   raise exception 'Poll answer period has ended' using errcode='23514';
 end if;
 if not exists(select 1 from jsonb_array_elements(p.options) item where item->>'key'=new.option_key) then
   raise exception 'Unknown poll option' using errcode='23514';
 end if;
 if not exists(
   select 1 from public.connection c join public.person v on v.id=c.person_id
   join public.premises m on m.id=c.premises_id
   where c.person_id=new.person_id and c.status='active' and v.status='active'
     and v.is_test=p.is_test and m.status='active' and m.is_test=p.is_test and m.building_id=any(p.building_ids)
     and (c.start_date is null or c.start_date<=local_day) and (c.end_date is null or c.end_date>=local_day)
     and exists(select 1 from public.profile f where f.person_id=v.id and f.archived_at is null and f.is_test=p.is_test)
 ) then raise exception 'Poll voter is not eligible' using errcode='23514'; end if;
 if TG_OP='UPDATE' then
   if (new.poll_id,new.person_id) is distinct from (old.poll_id,old.person_id) or new.version<>old.version+1 then
     raise exception 'Invalid answer version or identity' using errcode='23514';
   end if;
 elsif new.version<>1 then raise exception 'Invalid first answer version' using errcode='23514';
 end if;
 new.answered_at:=stamp;
 return new;
end $$;
drop trigger if exists poll_answer_guard on public.poll_answer;
create trigger poll_answer_guard before insert or update of option_key,answered_at on public.poll_answer for each row execute function public.poll_answer_guard();
drop trigger if exists poll_answer_log_immutable on public.poll_answer_log;
create trigger poll_answer_log_immutable before update or delete on public.poll_answer_log for each statement execute function public.audience_history_immutable();
do $$ declare t text; begin
 foreach t in array array['poll','poll_answer','poll_answer_log'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke execute on function public.poll_guard(),public.poll_answer_guard() from public,anon,authenticated;
revoke all on sequence public.poll_answer_log_id_seq from public,anon,authenticated;

-- Direct SQL follows the same gate-first order; explicit pre-locks obey ADR-019.
drop trigger if exists poll_audience_gate on public.poll;
create trigger poll_audience_gate before insert or update or delete on public.poll for each statement execute function public.audience_statement_gate();
drop trigger if exists poll_answer_audience_gate on public.poll_answer;
create trigger poll_answer_audience_gate before insert or update or delete on public.poll_answer for each statement execute function public.audience_statement_gate();
drop trigger if exists poll_answer_no_delete on public.poll_answer;
create trigger poll_answer_no_delete before delete on public.poll_answer for each statement execute function public.audience_history_immutable();
