-- Сроки ОСИ не выдумываются: включение назначения требует заполненных регламентов.
insert into time_rule(key) values ('task_accept'),('task_escalation') on conflict do nothing;
alter table task add column if not exists acceptance_version integer;
alter table task add column if not exists acceptance_due_at timestamptz;
alter table task add column if not exists overdue_at timestamptz;
alter table task add column if not exists next_action_notified_at timestamptz;
alter table notification add column if not exists task_id uuid references task(id);
create index if not exists task_due_pending on task(due_at) where state not in ('accepted_admin','canceled') and overdue_at is null;
create table if not exists job_schedule (
 template_id uuid primary key references job_template(id), enabled boolean not null default false,
 next_run_at timestamptz not null, interval_hours integer not null check(interval_hours between 1 and 8784),
 due_hours integer not null check(due_hours between 1 and 8784), assignee_person_id uuid references person(id),
 configured_by uuid not null references person(id), version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists job_queue (
 id bigserial primary key, kind text not null, payload jsonb not null, run_after timestamptz not null default now(),
 state text not null default 'queued' check(state in ('queued','running','done','failed','dead')),
 locked_by text, locked_at timestamptz, attempts integer not null default 0, max_attempts integer not null default 5,
 last_error text, dedup_key text unique, created_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists job_queue_pending on job_queue(state,run_after);
create table if not exists job_run (
 id uuid primary key default gen_random_uuid(), template_id uuid not null references job_template(id),
 template_version integer not null, scheduled_at timestamptz not null, schedule_version integer not null,
 queue_id bigint not null unique references job_queue(id), task_id uuid unique references task(id),
 missed_at timestamptz, created_at timestamptz not null default now(),
 unique(template_id,scheduled_at), foreign key(template_id,template_version) references job_template_version(template_id,version)
);
do $$ declare t text; begin
 foreach t in array array['job_schedule','job_queue','job_run'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;
