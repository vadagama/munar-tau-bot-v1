-- IDEA-02 / MOD-01–03: оригиналы неизменяемы, решения и оспаривания отдельно.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.initiative_comment (
 id uuid primary key default gen_random_uuid(),
 initiative_id uuid not null references public.initiative(id),
 author_person_id uuid not null references public.person(id),
 body text not null check(length(btrim(body)) between 1 and 10000),
 is_test boolean not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists initiative_comment_page on public.initiative_comment(initiative_id,created_at,id);
do $$ begin if not exists(select 1 from pg_constraint where conname='moderation_action_comment_fk' and conrelid='public.moderation_action'::regclass) then
 alter table public.moderation_action add constraint moderation_action_comment_fk foreign key(target_comment_id) references public.initiative_comment(id);
end if;end $$;
create unique index if not exists moderation_comment_hidden on public.moderation_action(target_comment_id) where kind='hide_comment' and revoked_at is null;
create table if not exists public.moderation_appeal (
 id uuid primary key default gen_random_uuid(),
 action_id uuid not null references public.moderation_action(id),
 appellant_person_id uuid not null references public.person(id),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 status text not null default 'open' check(status in ('open','resolved')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 check((status='resolved')=(resolved_at is not null))
);
create unique index if not exists moderation_one_open_appeal on public.moderation_appeal(action_id) where status='open';
create index if not exists moderation_appeal_queue on public.moderation_appeal(status,created_at,id);
create table if not exists public.moderation_decision (
 id uuid primary key default gen_random_uuid(),
 appeal_id uuid not null unique references public.moderation_appeal(id),
 action_id uuid not null references public.moderation_action(id),
 resolution text not null check(resolution in ('uphold','shorten','revoke')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 before_version integer not null,
 after_version integer not null check(after_version=before_version+1),
 until_at timestamptz,
 by_person_id uuid not null references public.person(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(action_id,after_version)
);
create or replace function public.initiative_comment_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare item public.initiative; stamp timestamptz:=clock_timestamp(); local_day date:=(stamp at time zone 'Asia/Almaty')::date;
begin
 select * into item from public.initiative where id=new.initiative_id;
 if not found or item.publication_state<>'published' or item.is_test<>new.is_test then
   raise exception 'Initiative comments unavailable' using errcode='23514';
 end if;
 if exists(select 1 from public.moderation_action m where m.target_person_id=new.author_person_id
   and m.is_test=new.is_test and m.kind='restrict_author' and m.revoked_at is null and m.until_at>stamp) then
   raise exception 'Comment author is restricted' using errcode='23514';
 end if;
 if not exists(select 1 from public.connection c join public.premises m on m.id=c.premises_id
   join public.person p on p.id=c.person_id where p.id=new.author_person_id and p.status='active' and p.is_test=new.is_test
   and m.status='active' and m.is_test=new.is_test and m.building_id=any(item.approved_building_ids) and c.status='active'
   and (c.start_date is null or c.start_date<=local_day) and (c.end_date is null or c.end_date>=local_day)
   and exists(select 1 from public.profile f where f.person_id=p.id and f.archived_at is null and f.is_test=new.is_test)
 ) then raise exception 'Comment author outside audience' using errcode='23514'; end if;
 new.created_at:=stamp;return new;
end $$;
drop trigger if exists initiative_comment_guard on public.initiative_comment;
create trigger initiative_comment_guard before insert on public.initiative_comment for each row execute function public.initiative_comment_guard();
drop trigger if exists initiative_comment_immutable on public.initiative_comment;
create trigger initiative_comment_immutable before update or delete on public.initiative_comment for each statement execute function public.audience_history_immutable();
create or replace function public.moderation_action_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare item public.initiative;
begin
 if TG_OP='UPDATE' then
   if (new.id,new.initiative_id,new.kind,new.target_person_id,new.target_comment_id,new.reason,new.original_until_at,new.created_by,new.created_at,new.is_test) is distinct from
     (old.id,old.initiative_id,old.kind,old.target_person_id,old.target_comment_id,old.reason,old.original_until_at,old.created_by,old.created_at,old.is_test)
     or new.version<>old.version+1 or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (new.kind='restrict_author' and (new.until_at is null or new.until_at>old.until_at))
     or (new.kind='hide_comment' and new.until_at is not null) then
     raise exception 'Invalid moderation revision' using errcode='23514';
   end if;
 else
   select * into item from public.initiative where id=new.initiative_id;
   if not found or item.is_test<>new.is_test or new.version<>1 or new.revoked_at is not null then
     raise exception 'Invalid moderation target' using errcode='23514';
   end if;
   if new.kind='hide_comment' then
     if not exists(select 1 from public.initiative_comment c where c.id=new.target_comment_id and c.initiative_id=new.initiative_id
       and c.author_person_id=new.target_person_id and c.is_test=new.is_test) or new.until_at is not null or new.original_until_at is not null then
       raise exception 'Invalid hidden comment' using errcode='23514';
     end if;
   elsif new.target_person_id<>item.author_person_id and not exists(select 1 from public.initiative_comment c
     where c.initiative_id=new.initiative_id and c.author_person_id=new.target_person_id and c.is_test=new.is_test) then
     raise exception 'Invalid restricted author' using errcode='23514';
   end if;
   new.created_at:=clock_timestamp();
   if new.kind='restrict_author' and (new.until_at is distinct from new.original_until_at or new.until_at<=new.created_at) then
     raise exception 'Restriction needs future deadline' using errcode='23514';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists moderation_action_guard on public.moderation_action;
create trigger moderation_action_guard before insert or update on public.moderation_action for each row execute function public.moderation_action_guard();
drop trigger if exists moderation_action_no_delete on public.moderation_action;
create trigger moderation_action_no_delete before delete on public.moderation_action for each statement execute function public.audience_history_immutable();
create or replace function public.moderation_appeal_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if TG_OP='INSERT' then
   if new.version<>1 or new.status<>'open' or not exists(select 1 from public.moderation_action a
     where a.id=new.action_id and a.target_person_id=new.appellant_person_id and a.revoked_at is null) then
     raise exception 'Invalid appeal' using errcode='23514';
   end if;
 elsif (new.id,new.action_id,new.appellant_person_id,new.reason,new.created_at) is distinct from
       (old.id,old.action_id,old.appellant_person_id,old.reason,old.created_at) or new.version<>old.version+1
       or old.status<>'open' or new.status<>'resolved' then
   raise exception 'Invalid appeal revision' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists moderation_appeal_guard on public.moderation_appeal;
create trigger moderation_appeal_guard before insert or update on public.moderation_appeal for each row execute function public.moderation_appeal_guard();
drop trigger if exists moderation_appeal_no_delete on public.moderation_appeal;
create trigger moderation_appeal_no_delete before delete on public.moderation_appeal for each statement execute function public.audience_history_immutable();
drop trigger if exists moderation_decision_immutable on public.moderation_decision;
create trigger moderation_decision_immutable before update or delete on public.moderation_decision for each statement execute function public.audience_history_immutable();
create or replace function public.moderation_decision_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.moderation_action m join public.moderation_appeal a on a.action_id=m.id
   where m.id=new.action_id and a.id=new.appeal_id and a.status='open' and m.version=new.after_version
   and m.until_at is not distinct from new.until_at) then
   raise exception 'Decision must resolve current action and appeal' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists moderation_decision_guard on public.moderation_decision;
create trigger moderation_decision_guard before insert on public.moderation_decision for each row execute function public.moderation_decision_guard();
-- Изменённое действие и закрытая жалоба обязаны иметь одно append-only решение в той же транзакции.
create or replace function public.moderation_resolution_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if TG_TABLE_NAME='moderation_action' then
   if not exists(select 1 from public.moderation_decision d join public.moderation_appeal a on a.id=d.appeal_id
     where d.action_id=new.id and d.before_version=old.version and d.after_version=new.version and a.action_id=new.id and a.status='resolved'
       and d.until_at is not distinct from new.until_at
       and ((d.resolution='revoke' and new.revoked_at is not null) or
            (d.resolution='uphold' and new.until_at is not distinct from old.until_at and new.revoked_at is not distinct from old.revoked_at) or
            (d.resolution='shorten' and new.kind='restrict_author' and new.until_at<old.until_at and new.revoked_at is null))) then
     raise exception 'Moderation revision requires decision' using errcode='23514';
   end if;
 else
   if not exists(select 1 from public.moderation_decision d where d.appeal_id=new.id and d.action_id=new.action_id) then
     raise exception 'Resolved appeal requires decision' using errcode='23514';
   end if;
 end if;
 return null;
end $$;
drop trigger if exists moderation_action_resolution on public.moderation_action;
create constraint trigger moderation_action_resolution after update on public.moderation_action deferrable initially deferred for each row execute function public.moderation_resolution_guard();
drop trigger if exists moderation_appeal_resolution on public.moderation_appeal;
create constraint trigger moderation_appeal_resolution after update on public.moderation_appeal deferrable initially deferred for each row execute function public.moderation_resolution_guard();
do $$ declare t text;begin
 foreach t in array array['initiative_comment','moderation_appeal','moderation_decision'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('drop trigger if exists %I on public.%I',t||'_gate',t);
   execute format('create trigger %I before insert or update or delete on public.%I for each statement execute function public.audience_statement_gate()',t||'_gate',t);
 end loop;
end $$;
revoke execute on function public.initiative_comment_guard(),public.moderation_action_guard(),public.moderation_appeal_guard(),public.moderation_resolution_guard(),public.moderation_decision_guard() from public,anon,authenticated;
