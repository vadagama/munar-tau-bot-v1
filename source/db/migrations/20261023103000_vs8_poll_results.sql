select pg_advisory_xact_lock(814733,8);
create table if not exists public.poll_result (
 poll_id uuid primary key references public.poll(id),
 as_of timestamptz not null,
 participants_count integer not null check(participants_count>=0),
 distribution jsonb not null check(jsonb_typeof(distribution)='array'),
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.poll_result_participant (
 poll_id uuid not null references public.poll_result(poll_id),
 person_id uuid not null,
 primary key(poll_id,person_id)
);
create or replace function public.poll_instant(us bigint) returns timestamptz
language sql immutable strict set search_path=pg_catalog as $$
 select to_timestamp((us/1000000)::double precision)+(us%1000000)*interval '1 microsecond'
$$;
create or replace function public.poll_result_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare p public.poll; item jsonb; keys text[]:='{}'; total bigint:=0; amount numeric;
begin
 select * into p from public.poll where id=new.poll_id;
 if not found or p.state<>'open' or clock_timestamp()<p.closes_at or new.as_of<>p.closes_at then
   raise exception 'Poll result requires elapsed open poll' using errcode='23514';
 end if;
 for item in select value from jsonb_array_elements(new.distribution) loop
   if jsonb_typeof(item->'count') is distinct from 'number' or jsonb_typeof(item->'option_key') is distinct from 'string' then
     raise exception 'Invalid result distribution' using errcode='23514';
   end if;
   amount:=(item->>'count')::numeric;
   if amount<0 or amount<>trunc(amount) or (item->>'option_key')=any(keys) or
      not exists(select 1 from jsonb_array_elements(p.options) o where o->>'key'=item->>'option_key') then
     raise exception 'Invalid result distribution' using errcode='23514';
   end if;
   total:=total+amount;
   keys:=array_append(keys,item->>'option_key');
 end loop;
 if total<>new.participants_count or cardinality(keys)<>jsonb_array_length(p.options) then
   raise exception 'Invalid result totals' using errcode='23514';
 end if;
 return new;
end $$;
create or replace function public.poll_final_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if new.state=old.state then return new; end if;
 if new.state='closed' then
   if stamp<old.closes_at or not exists(select 1 from public.poll_result r where r.poll_id=old.id and r.as_of=old.closes_at
      and r.participants_count=(select count(*) from public.poll_result_participant p where p.poll_id=old.id)) then
     raise exception 'Poll result snapshot is required' using errcode='23514';
   end if;
   new.closed_at:=stamp;
 elsif new.state='canceled' then
   if stamp>=old.closes_at or exists(select 1 from public.poll_result where poll_id=old.id) then
     raise exception 'Elapsed poll cannot be canceled' using errcode='23514';
   end if;
   new.canceled_at:=stamp;
 end if;
 return new;
end $$;
create or replace function public.poll_result_committed() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare target uuid; p public.poll; r public.poll_result;
begin
 target:=new.poll_id;
 select * into p from public.poll where id=target;
 select * into r from public.poll_result where poll_id=target;
 if p.state<>'closed' or r.poll_id is null or r.participants_count<>(select count(*) from public.poll_result_participant where poll_id=target) then
   raise exception 'Incomplete poll result snapshot' using errcode='23514';
 end if;
 return null;
end $$;
drop trigger if exists poll_final_guard on public.poll;
create trigger poll_final_guard before update of state on public.poll for each row execute function public.poll_final_guard();
drop trigger if exists poll_result_guard on public.poll_result;
create trigger poll_result_guard before insert on public.poll_result for each row execute function public.poll_result_guard();
do $$ declare t text; begin
 foreach t in array array['poll_result','poll_result_participant'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('drop trigger if exists poll_result_immutable on public.%I',t);
   execute format('create trigger poll_result_immutable before update or delete on public.%I for each statement execute function public.audience_history_immutable()',t);
   execute format('drop trigger if exists poll_result_gate on public.%I',t);
   execute format('create trigger poll_result_gate before insert or update or delete on public.%I for each statement execute function public.audience_statement_gate()',t);
   execute format('drop trigger if exists poll_result_committed on public.%I',t);
   execute format('create constraint trigger poll_result_committed after insert on public.%I deferrable initially deferred for each row execute function public.poll_result_committed()',t);
 end loop;
end $$;
revoke execute on function public.poll_instant(bigint),public.poll_result_guard(),public.poll_final_guard(),public.poll_result_committed() from public,anon,authenticated;
