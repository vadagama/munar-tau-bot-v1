-- EMG/PUB: доступ только через Edge API/PDP. Тестовые и обычные данные разделены.
create sequence if not exists incident_number_seq;
create table if not exists incident (
 id uuid primary key default gen_random_uuid(), number text not null unique default ('АВ-' || nextval('incident_number_seq')),
 state text not null default 'signal_check' check(state in ('signal_check','confirmed','not_confirmed','mitigation','recovery_check','completed')),
 title text not null, place text not null, service text not null, forecast text not null default 'Уточняется',
 next_update_at timestamptz, first_signal_at timestamptz not null, responsible_person_id uuid not null references person(id),
 public_text text, published boolean not null default false, restrictions text not null default '',
 recovery_at timestamptz, completed_at timestamptz, version integer not null default 1 check(version>0),
 created_by uuid not null references person(id), created_at timestamptz not null default now(), is_test boolean not null,
 check(state<>'completed' or (completed_at is not null and recovery_at is not null))
);
create table if not exists incident_scope (
 id uuid primary key default gen_random_uuid(), incident_id uuid not null references incident(id), building_id uuid not null references building(id),
 zone text not null default '', service text not null, premises_ids uuid[] not null default '{}',
 recovered_at timestamptz, recovery_method text, active boolean not null default true,
 unique(incident_id,building_id,zone,service), check(zone='' or cardinality(premises_ids)>0),
 check((recovered_at is null)=(recovery_method is null))
);
create index if not exists incident_scope_parent on incident_scope(incident_id);
create table if not exists incident_log (
 id bigserial primary key, incident_id uuid not null references incident(id), from_state text, to_state text not null,
 actor_person_id uuid references person(id), reason text not null, meta jsonb not null default '{}', at timestamptz not null default now()
);
create index if not exists incident_log_parent on incident_log(incident_id,id);
create table if not exists incident_request (
 incident_id uuid not null references incident(id), request_id uuid not null references request(id),
 linked_by uuid not null references person(id), linked_at timestamptz not null default now(), primary key(incident_id,request_id)
);
alter table common_work add column if not exists incident_id uuid references incident(id);
create index if not exists common_work_incident on common_work(incident_id);
create table if not exists publication (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('announcement','outage','work_report','financial_report')),
 title text not null, body text not null, state text not null default 'draft' check(state in ('draft','pending_approval','scheduled','published','archived')),
 incident_id uuid references incident(id), common_work_id uuid references common_work(id), document_version_id uuid,
 requires_document boolean not null default false, approved_by uuid references person(id), approval_note text,
 publish_at timestamptz, published_at timestamptz, service text, planned_start timestamptz, planned_end timestamptz,
 responsible_person_id uuid references person(id), restored_at timestamptz, restoration_method text,
 created_by uuid not null references person(id), created_at timestamptz not null default now(), version integer not null default 1, is_test boolean not null,
 check(version>0), check(kind<>'outage' or (service is not null and planned_start is not null and planned_end>planned_start and responsible_person_id is not null)),
 check((restored_at is null)=(restoration_method is null))
);
create table if not exists publication_scope (
 publication_id uuid not null references publication(id), building_id uuid not null references building(id), primary key(publication_id,building_id)
);
create table if not exists publication_log (
 id bigserial primary key, publication_id uuid not null references publication(id), actor_person_id uuid references person(id),
 action text not null, version integer not null, snapshot jsonb not null, at timestamptz not null default now()
);
-- Каждая версия рассылки хранит собственный охват; курсор фиксируется вместе с outbox.
create table if not exists broadcast (
 id uuid primary key default gen_random_uuid(), dedup_key text not null unique,
 event_type text not null check(event_type in ('incident','publication','work.report')),
 text jsonb not null, scope jsonb not null, is_test boolean not null,
 incident_id uuid references incident(id), publication_id uuid references publication(id),
 cursor_person_id uuid, created_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists broadcast_pending on broadcast(created_at) where completed_at is null;
create index if not exists publication_scheduled on publication(publish_at) where state='scheduled';
do $$ declare t text; begin
 foreach t in array array['incident','incident_scope','incident_log','incident_request','publication','publication_scope','publication_log','broadcast'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated',t);
 end loop;
end $$;
create or replace function protect_incident_history() returns trigger language plpgsql as $$
begin raise exception 'incident/publication history is append-only'; end $$;
drop trigger if exists incident_log_immutable on incident_log;
create trigger incident_log_immutable before update or delete on incident_log for each row execute function protect_incident_history();
drop trigger if exists publication_log_immutable on publication_log;
create trigger publication_log_immutable before update or delete on publication_log for each row execute function protect_incident_history();
revoke all on sequence incident_number_seq,incident_log_id_seq,publication_log_id_seq from anon,authenticated;

alter table notification_digest_item add column if not exists event_ref jsonb not null default '{}';
create table if not exists duty_shift (
 id uuid primary key default gen_random_uuid(), building_id uuid not null references building(id),
 primary_person_id uuid not null references person(id), reserve_person_id uuid not null references person(id), admin_person_id uuid not null references person(id),
 starts_at timestamptz not null, ends_at timestamptz not null, emergency_phone text not null,
 created_by uuid not null references person(id), created_at timestamptz not null default now(), is_test boolean not null,
 check(ends_at>starts_at), check(primary_person_id<>reserve_person_id)
);
create index if not exists duty_shift_window on duty_shift(building_id,starts_at,ends_at);
create table if not exists emergency_signal (
 id uuid primary key default gen_random_uuid(), request_id uuid references request(id), task_id uuid references task(id), building_id uuid not null references building(id),
 description text not null, created_by uuid not null references person(id), created_at timestamptz not null default now(), is_test boolean not null,
 shift_id uuid references duty_shift(id), responsible_person_id uuid references person(id), stage text not null check(stage in ('primary','reserve','administrator','unassigned')),
 accepted_at timestamptz, version integer not null default 1, check(num_nonnulls(request_id,task_id)=1)
);
create table if not exists emergency_signal_log (
 id bigserial primary key, signal_id uuid not null references emergency_signal(id), action text not null,
 responsible_person_id uuid references person(id), actor_person_id uuid references person(id), at timestamptz not null default now()
);
insert into time_rule(key) values('emergency_primary'),('emergency_reserve'),('incident_update_escalation') on conflict do nothing;
insert into time_rule_version(rule_id,version,params,reason)
 select id,1,'{"hours":0.16666666666666666,"clock":"calendar"}'::jsonb,'TIM-05: 10 календарных минут, решение 16.10.2026'
 from time_rule where key in ('emergency_primary','emergency_reserve') on conflict(rule_id,version) do nothing;
do $$ declare t text; begin
 foreach t in array array['duty_shift','emergency_signal','emergency_signal_log'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated',t);
 end loop;
end $$;
drop trigger if exists emergency_signal_log_immutable on emergency_signal_log;
create trigger emergency_signal_log_immutable before update or delete on emergency_signal_log for each row execute function protect_incident_history();
create table if not exists publication_attachment (
 publication_id uuid not null references publication(id), attachment_id uuid not null references attachment(id),
 selected_by uuid not null references person(id), selected_at timestamptz not null default now(), primary key(publication_id,attachment_id)
);
create table if not exists publication_request (
 publication_id uuid not null references publication(id), request_id uuid not null references request(id), primary key(publication_id,request_id)
);
alter table publication_attachment enable row level security;
alter table publication_request enable row level security;
revoke all on publication_attachment,publication_request from anon,authenticated;
-- Удалять при отсоединении только связи работ, созданные этим инцидентом.
create table if not exists incident_work_request (
 incident_id uuid not null references incident(id), common_work_id uuid not null references common_work(id), request_id uuid not null references request(id),
 primary key(incident_id,common_work_id,request_id),
 foreign key(common_work_id,request_id) references common_work_request(common_work_id,request_id) on delete cascade
);
alter table incident_work_request enable row level security;
revoke all on incident_work_request from anon,authenticated;

revoke all on sequence emergency_signal_log_id_seq from anon,authenticated;
