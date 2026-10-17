-- VS-4 WRK/JOB. TIM и расписание остаются в VS-5.
create sequence if not exists task_number_seq;
create sequence if not exists common_work_number_seq;
create table if not exists common_work (
 id uuid primary key default gen_random_uuid(),
 number text not null unique default ('ОР-' || nextval('common_work_number_seq')),
 title text not null, state text not null default 'planned'
 check(state in ('planned','in_progress','on_review','completed','canceled')),
 building_ids uuid[] not null, is_test boolean not null,
 version integer not null default 1 check(version>0),
 created_by uuid not null references person(id), created_at timestamptz not null default now(),
 completed_at timestamptz
);
create table if not exists common_work_request (
 common_work_id uuid not null references common_work(id), request_id uuid not null references request(id),
 primary key(common_work_id,request_id)
);
create index if not exists common_work_request_request on common_work_request(request_id);
create table if not exists job_template (
 id uuid primary key default gen_random_uuid(), name text not null,
 blueprint jsonb not null, buildings uuid[] not null,
 active boolean not null default true, is_test boolean not null,
 version integer not null default 1 check(version>0),
 created_by uuid not null references person(id), created_at timestamptz not null default now()
);
create table if not exists job_template_version (
 template_id uuid not null references job_template(id), version integer not null check(version>0),
 blueprint jsonb not null, created_by uuid not null references person(id), created_at timestamptz not null default now(),
 primary key(template_id,version)
);
create table if not exists task (
 id uuid primary key default gen_random_uuid(),
 number text not null unique default ('ЗД-' || nextval('task_number_seq')),
 request_id uuid references request(id), common_work_id uuid references common_work(id),
 title text not null, instruction text not null,
 assignee_person_id uuid references person(id),
 state text not null default 'created' check(state in ('created','awaiting_acceptance','accepted','in_progress','suspended','on_review','rework','accepted_admin','canceled')),
 prev_state text check(prev_state in ('accepted','in_progress')),
 suspend_reason text, next_action text, next_action_at timestamptz,
 due_at timestamptz not null, depends_on_task_id uuid references task(id),
 required_evidence jsonb not null default '[]' check(jsonb_typeof(required_evidence)='array'),
 start_conditions jsonb, access_required boolean not null default false,
 is_required boolean not null default true, is_test boolean not null,
 template_id uuid, template_version integer,
 version integer not null default 1 check(version>0), started_at timestamptz,
 created_by uuid not null references person(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(num_nonnulls(request_id,common_work_id)=1),
 check(depends_on_task_id is distinct from id),
 check((state='suspended')=(prev_state is not null)),
 check(state in ('created','canceled') or assignee_person_id is not null),
 check(num_nonnulls(template_id,template_version) in (0,2)),
 foreign key(template_id,template_version) references job_template_version(template_id,version)
);
create index if not exists task_request on task(request_id);
create index if not exists task_common_work on task(common_work_id);
create index if not exists task_assignee_state on task(assignee_person_id,state);
create index if not exists task_dependency on task(depends_on_task_id);
create table if not exists task_log (
 id bigserial primary key, task_id uuid not null references task(id),
 from_state text, to_state text not null, actor_person_id uuid not null references person(id),
 reason text, meta jsonb not null default '{}', at timestamptz not null default now()
);
create index if not exists task_log_task on task_log(task_id,id);
create table if not exists task_report (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references task(id),
 version integer not null check(version>0), performed_work text not null, performed_at timestamptz not null,
 result text not null, limitations text not null default '', evidence jsonb not null default '[]',
 missing_evidence jsonb not null default '[]',
 created_by uuid not null references person(id), created_at timestamptz not null default now(),
 unique(task_id,version)
);
create table if not exists visit (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references task(id),
 interval_start timestamptz not null, interval_end timestamptz not null,
 status text not null default 'proposed' check(status in ('proposed','confirmed','missed','rescheduled')),
 confirmed_by_person uuid references person(id), confirmed_by_kind text check(confirmed_by_kind in ('author','participant')),
 note text, version integer not null default 1 check(version>0),
 created_by uuid not null references person(id), created_at timestamptz not null default now(),
 check(interval_end>interval_start), check(status<>'confirmed' or (confirmed_by_person is not null and confirmed_by_kind is not null))
);
create index if not exists visit_task on visit(task_id);
create table if not exists common_work_log (
 id bigserial primary key, common_work_id uuid not null references common_work(id),
 from_state text, to_state text not null, actor_person_id uuid not null references person(id),
 meta jsonb not null default '{}', at timestamptz not null default now()
);
create index if not exists common_work_log_work on common_work_log(common_work_id,id);
-- История защищена от UPDATE/DELETE, включая владельца. TRUNCATE — только тестовому владельцу.
create or replace function protect_task_history() returns trigger language plpgsql as $$
begin raise exception 'task history is append-only'; end $$;
do $$ declare t text; begin
 foreach t in array array['task_log','task_report','job_template_version','common_work_log'] loop
  execute format('drop trigger if exists task_history_immutable on %I',t);
  execute format('create trigger task_history_immutable before update or delete on %I for each row execute function protect_task_history()',t);
 end loop;
 foreach t in array array['task','task_log','task_report','visit','common_work','common_work_request','common_work_log','job_template','job_template_version'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on table %I from anon,authenticated',t);
 end loop;
end $$;
revoke all on sequence task_number_seq,common_work_number_seq from anon,authenticated;
