-- VS-5: расширение существующего TIM/NTF без изменения действующих сроков.
alter table time_rule add column if not exists kind text not null default 'operational' check(kind in ('operational','legal'));
alter table time_rule add column if not exists legal_source text;
alter table time_rule add column if not exists legal_revision text;
alter table time_rule add column if not exists legal_effective_from date;
alter table time_rule add column if not exists legal_scope text;
alter table time_rule add column if not exists legal_limits jsonb;
-- Автор — исторический идентификатор: конфигурация сохраняется при очистке тестовых персон.
alter table time_rule_version add column if not exists created_by uuid;
alter table time_rule_version add column if not exists reason text;
alter table time_rule_version add column if not exists legal_basis jsonb;
alter table timer add column if not exists canceled_at timestamptz;
alter table timer add column if not exists payload jsonb not null default '{}';
insert into time_rule(key) values ('work_schedule'),('author_reminder'),('digest_time') on conflict do nothing;
insert into time_rule_version(rule_id,version,params,reason)
select id,1,case key
 when 'work_schedule' then '{"hours":12,"clock":"working","timezone":"Asia/Almaty","start":8,"end":20,"days":[0,1,2,3,4,5,6]}'::jsonb
 when 'author_reminder' then '{"hours":48,"clock":"calendar"}'::jsonb
 else '{"hours":24,"clock":"calendar","at":"shift_end"}'::jsonb end,'TIM-05/NTF-01/WRK-07: согласованные начальные значения'
from time_rule where key in ('work_schedule','author_reminder','digest_time') on conflict(rule_id,version) do nothing;

create table if not exists notification_pref (
 person_id uuid not null references person(id), event_type text not null check(event_type in ('publication','work.report','request.status')),
 mode text not null default 'immediate' check(mode in ('immediate','digest','off')),
 updated_at timestamptz not null default now(), primary key(person_id,event_type),
 check(event_type <> 'request.status' or mode <> 'digest')
);
alter table notification add column if not exists important boolean not null default false;
alter table notification add column if not exists priority integer not null default 1;
alter table notification add column if not exists request_id uuid references request(id);
alter table notification add column if not exists audience text not null default 'personal' check(audience in ('personal','resident','staff','publication'));
alter table notification add column if not exists is_test boolean not null default false;
alter table notification add column if not exists lease_token uuid;
alter table notification drop constraint if exists notification_state_check;
alter table notification add constraint notification_state_check check(state in ('queued','sending','sent','failed','canceled'));
update notification set is_test=true where channel='simulator' and not is_test;
create index if not exists notification_dispatch_idx on notification(priority,created_at) where state='queued';
alter table outbox add column if not exists dedup_key text;
create unique index if not exists outbox_dedup_key on outbox(dedup_key) where dedup_key is not null;
alter table outbox add column if not exists attempts integer not null default 0;
alter table outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table outbox add column if not exists last_error text;
create table if not exists notification_followup (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null unique references notification(id),
 state text not null default 'open' check(state in ('open','done')), result text,
 created_at timestamptz not null default now(), completed_at timestamptz, completed_by uuid references person(id),
 check(state='open' or (result is not null and completed_at is not null and completed_by is not null))
);
create table if not exists notification_digest_item (
 id uuid primary key default gen_random_uuid(), recipient_person_id uuid not null references person(id),
 event_type text not null check(event_type in ('publication','work.report')), dedup_key text not null unique,
 text text not null, building_ids uuid[] not null, is_test boolean not null,
 created_at timestamptz not null default now(), consumed_at timestamptz
);
create index if not exists digest_pending on notification_digest_item(recipient_person_id,created_at) where consumed_at is null;
create table if not exists notification_digest_run (
 person_id uuid not null references person(id), local_day date not null, created_at timestamptz not null default now(), primary key(person_id,local_day)
);
do $$ declare t text; begin
 foreach t in array array['notification_pref','notification_followup','notification_digest_item','notification_digest_run'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;

create or replace function protect_time_rule_version() returns trigger language plpgsql as $$
begin raise exception 'time_rule_version is append-only'; end $$;
drop trigger if exists time_rule_version_immutable on time_rule_version;
create trigger time_rule_version_immutable before update or delete on time_rule_version for each row execute function protect_time_rule_version();

alter table request add column if not exists first_response_start_at timestamptz;

alter table notification_digest_run add column if not exists cutoff_at timestamptz not null default now();
alter table notification_digest_run add column if not exists pages integer not null default 1;
alter table notification_digest_run add column if not exists completed_at timestamptz;
create index if not exists notification_failed on notification(created_at) where state='failed' and important;
