-- REP-05: намерение и полномочия неизменяемы, lease не позволяет старому worker завершить новый запуск.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.report_export_job (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('requests','tasks','incidents')),
 requested_by_person_id uuid not null references public.person(id),requested_by_profile_id uuid not null references public.profile(id),
 real_person_id uuid not null references public.person(id),real_profile_id uuid not null references public.profile(id),
 emulation_session_id uuid references public.emulation_session(id),is_test boolean not null,
 filters jsonb not null check(jsonb_typeof(filters)='object'),permission_snapshot jsonb not null check(jsonb_typeof(permission_snapshot)='object'),
 scope_snapshot jsonb not null check(jsonb_typeof(scope_snapshot)='object'),as_of timestamptz not null,
 state text not null default 'pending' check(state in ('pending','running','ready','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),lease_token uuid,lease_until timestamptz,
 storage_path text unique,size_bytes integer check(size_bytes between 1 and 20971520),row_count integer check(row_count between 0 and 10000),
 object_ids uuid[] not null default '{}',last_error text check(last_error in ('ACCESS_REVOKED','EXPORT_FAILED','REPORT_TOO_LARGE')),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 check(case when state='running' then lease_token is not null and lease_until is not null else lease_token is null and lease_until is null end),
 check(case when state='ready' then storage_path is not null and size_bytes is not null and row_count is not null else storage_path is null and size_bytes is null and row_count is null and cardinality(object_ids)=0 end),
 check((state in ('ready','failed'))=(finished_at is not null)),
 check(state<>'ready' or cardinality(object_ids)=row_count),
 check((emulation_session_id is null and requested_by_person_id=real_person_id and requested_by_profile_id=real_profile_id) or (emulation_session_id is not null and is_test)),
 check((permission_snapshot->>'is_test') is not distinct from is_test::text)
);
create index if not exists report_export_queue on public.report_export_job(created_at,id) where state in ('pending','running');
create index if not exists report_export_creator on public.report_export_job(requested_by_profile_id,created_at desc,id);
create or replace function public.report_export_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if TG_OP='DELETE' then raise exception 'Export history is immutable' using errcode='42501'; end if;
 if TG_OP='INSERT' then
  if new.state<>'pending' or new.attempts<>0 then raise exception 'Export starts pending' using errcode='23514'; end if;
  if not exists(select 1 from public.person p join public.profile f on f.person_id=p.id where p.id=new.requested_by_person_id and f.id=new.requested_by_profile_id and p.is_test=new.is_test and f.is_test=new.is_test and p.status='active' and f.archived_at is null) then
   raise exception 'Export initiator unavailable' using errcode='23514'; end if;
 else
  if (to_jsonb(new)-array['state','attempts','lease_token','lease_until','storage_path','size_bytes','row_count','object_ids','last_error','finished_at']) is distinct from
     (to_jsonb(old)-array['state','attempts','lease_token','lease_until','storage_path','size_bytes','row_count','object_ids','last_error','finished_at']) then
    raise exception 'Export intent is immutable' using errcode='23514'; end if;
  if old.state in ('ready','failed') then raise exception 'Final export is immutable' using errcode='23514'; end if;
  if new.state='running' then
   if old.state='running' and old.lease_until>clock_timestamp() then raise exception 'Export is leased' using errcode='23514'; end if;
   if new.attempts<>old.attempts+1 then raise exception 'Export attempt must advance' using errcode='23514'; end if;
  elsif old.state<>'running' or new.state not in ('pending','ready','failed') or new.attempts<>old.attempts then
   raise exception 'Invalid export transition' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists report_export_guard on public.report_export_job;
create trigger report_export_guard before insert or update or delete on public.report_export_job for each row execute function public.report_export_guard();
alter table public.report_export_job enable row level security;
revoke all on public.report_export_job from public,anon,authenticated;
revoke execute on function public.report_export_guard() from public,anon,authenticated;
