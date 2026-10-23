-- REP-06: факты без текста/личностей, известные старые переходы сохраняют source_log_id/at.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.report_history_meta (
 singleton boolean primary key default true check(singleton),starts_at timestamptz not null default clock_timestamp()
);
insert into public.report_history_meta(singleton) values(true) on conflict do nothing;
create table if not exists public.report_request_event (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.request(id),
 kind text not null check(kind in ('state','response')),
 at timestamptz not null default now(),
 from_state text,to_state text,action text not null,
 request_version integer not null,
 confirmation_version integer not null,
 close_method text check(close_method in ('author','administrative')),
 is_test boolean not null,
 source_log_id bigint unique references public.request_log(id),
 message_id uuid unique references public.message(id),
 check((kind='state')=(source_log_id is not null)),
 check((kind='response')=(message_id is not null))
);
create index if not exists report_request_event_time on public.report_request_event(request_id,at,id);
create unique index if not exists report_request_first_response on public.report_request_event(request_id) where kind='response';
create or replace function public.capture_report_request_log() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare r public.request;
begin
 select * into r from public.request where id=new.request_id;
 insert into public.report_request_event(request_id,kind,at,from_state,to_state,action,request_version,confirmation_version,close_method,is_test,source_log_id)
 values(new.request_id,'state',new.at,new.from_state,new.to_state,coalesce(new.meta->>'action','unknown'),r.version,r.confirmation_version,
   case when new.to_state='closed' then r.close_method else null end,r.is_test,new.id) on conflict do nothing;
 return new;
end $$;
drop trigger if exists report_capture_log on public.request_log;
create trigger report_capture_log after insert on public.request_log for each row execute function public.capture_report_request_log();
-- Копируются только существующие доказательства, без восстановления недостающих границ.
insert into public.report_request_event(request_id,kind,at,from_state,to_state,action,request_version,confirmation_version,close_method,is_test,source_log_id)
select l.request_id,'state',l.at,l.from_state,l.to_state,coalesce(l.meta->>'action','unknown'),
 case when l.meta->>'version' ~ '^[0-9]{1,9}$' then (l.meta->>'version')::integer else 0 end,
 case when l.meta->'payload'->>'confirmation_version' ~ '^[0-9]{1,9}$' then (l.meta->'payload'->>'confirmation_version')::integer else 0 end,
 case l.meta->>'action' when 'confirm_result' then 'author' when 'admin_close' then 'administrative' else null end,r.is_test,l.id
from public.request_log l join public.request r on r.id=l.request_id order by l.at,l.id on conflict do nothing;
create table if not exists public.report_timer_event (
 id bigint generated always as identity primary key,
 timer_id uuid not null,request_id uuid not null references public.request(id),stage text not null,
 rule_version_id uuid not null references public.time_rule_version(id),params jsonb not null,
 state text not null,due_at timestamptz not null,at timestamptz not null default now(),
 baseline boolean not null default false
);
create index if not exists report_timer_event_time on public.report_timer_event(request_id,at,id);
create or replace function public.capture_report_timer() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.stage not like 'request_%' or not exists(select 1 from public.request where id=new.entity_id) then return new; end if;
 if TG_OP='UPDATE' and (new.state,new.rule_version_id,new.due_at) is not distinct from (old.state,old.rule_version_id,old.due_at) then return new; end if;
 insert into public.report_timer_event(timer_id,request_id,stage,rule_version_id,params,state,due_at)
 select new.id,new.entity_id,new.stage,new.rule_version_id,v.params,new.state,new.due_at from public.time_rule_version v where v.id=new.rule_version_id;
 return new;
end $$;
drop trigger if exists report_capture_timer on public.timer;
create trigger report_capture_timer after insert or update on public.timer for each row execute function public.capture_report_timer();
insert into public.report_timer_event(timer_id,request_id,stage,rule_version_id,params,state,due_at,at,baseline)
select t.id,t.entity_id,t.stage,t.rule_version_id,v.params,t.state,t.due_at,clock_timestamp(),true
from public.timer t join public.request r on r.id=t.entity_id join public.time_rule_version v on v.id=t.rule_version_id
where t.stage like 'request_%' and not exists(select 1 from public.report_timer_event e where e.timer_id=t.id);
-- Дата запуска задаётся явно; версии и датированные достижения не перезаписываются.
create table if not exists public.report_launch (
 id uuid primary key default gen_random_uuid(),launched_on date not null,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references public.person(id),
 reason text not null check(length(btrim(reason)) between 1 and 2000)
);
create table if not exists public.report_kpi_achievement (
 launch_id uuid primary key references public.report_launch(id),
 achieved_at timestamptz not null,people_count integer not null check(people_count>=100)
);
create or replace function public.capture_report_kpi() returns integer language plpgsql set search_path=pg_catalog,public as $$
declare launch public.report_launch; observed timestamptz; reached timestamptz; n integer; written integer;
begin
 perform public.audience_clock();observed:=clock_timestamp();
 select * into launch from public.report_launch order by created_at desc,id desc limit 1;
 if not found or observed<(launch.launched_on::timestamp at time zone 'Asia/Almaty') or
   exists(select 1 from public.report_kpi_achievement a where a.launch_id=launch.id) then return 0; end if;
 -- Временные окна связей учитываются даже без DML на их календарных границах.
 -- lead берётся ДО фильтра личности/режима: перенос связи завершает старую аудиторию.
 with versions as (
  select e.*,lead(e.effective_at,1,'infinity'::timestamptz) over(partition by e.connection_id order by e.effective_at,e.id) as next_at
  from public.audience_connection_event e
 ), raw as (
  select person_id,greatest(effective_at,coalesce(valid_from,'-infinity'::timestamptz),
   launch.launched_on::timestamp at time zone 'Asia/Almaty',(select starts_at from public.audience_history_meta where singleton)) as begins,
   least(next_at,coalesce(valid_until,'infinity'::timestamptz),observed,
   (launch.launched_on+interval '3 months') at time zone 'Asia/Almaty') as ends
  from versions where enabled and not is_test
 ), previous as (
  select *,max(ends) over(partition by person_id order by begins,ends rows between unbounded preceding and 1 preceding) as previous_end
  from raw where begins<ends
 ), grouped as (
  select *,sum(case when previous_end is null or begins>previous_end then 1 else 0 end)
   over(partition by person_id order by begins,ends) as group_id from previous
 ), merged as (
  select person_id,min(begins) as begins,max(ends) as ends from grouped group by person_id,group_id
 ), delta as (
  select begins as at,1 as change from merged union all select ends,-1 from merged
 ), totals as (
  select at,sum(sum(change)) over(order by at) as people from delta group by at
 ) select at,people::integer into reached,n from totals where people>=100 and at<observed order by at limit 1;
 if reached is not null then insert into public.report_kpi_achievement(launch_id,achieved_at,people_count) values(launch.id,reached,n) on conflict do nothing returning 1 into written; end if;
 return coalesce(written,0);
end $$;
-- Расчёт выполняется jobs/чтением по сохранённым интервалам, а не на каждой DML.
-- Утрата связи до следующего тика не удаляет историческое достижение.
-- Конфигурация также соблюдает gate до любых блокировок.
drop trigger if exists report_launch_gate on public.report_launch;
create trigger report_launch_gate before insert on public.report_launch for each statement execute function public.audience_statement_gate();
do $$ declare t text;begin
 foreach t in array array['report_history_meta','report_request_event','report_timer_event','report_launch','report_kpi_achievement'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('drop trigger if exists report_immutable on public.%I',t);
  execute format('create trigger report_immutable before update or delete on public.%I for each statement execute function public.audience_history_immutable()',t);
 end loop;
end $$;
revoke all on sequence public.report_request_event_id_seq,public.report_timer_event_id_seq from public,anon,authenticated;
revoke execute on function public.capture_report_request_log(),public.capture_report_timer(),public.capture_report_kpi() from public,anon,authenticated;
