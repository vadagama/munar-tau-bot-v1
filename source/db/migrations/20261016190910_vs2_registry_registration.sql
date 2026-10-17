-- VS-2: REG-01–14, IMP-01–13. Только серверный доступ; несколько собственников.
create table if not exists building_parking (
  parking_id uuid references building(id), house_id uuid references building(id),
  primary key (parking_id, house_id), check (parking_id <> house_id)
);
create index if not exists building_parking_house_idx on building_parking(house_id);
create table if not exists premises (
  id uuid primary key default gen_random_uuid(), building_id uuid not null references building(id),
  kind text not null check (kind in ('apartment','commercial','parking_slot','storage')),
  number text not null check (length(trim(number)) > 0), entrance integer, floor integer,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (building_id,kind,number)
);
create table if not exists connection (
  id uuid primary key default gen_random_uuid(), person_id uuid not null references person(id),
  premises_id uuid not null references premises(id),
  role text not null check (role in ('owner','tenant','resident','other')),
  basis text not null check (basis in ('initial_registry','ownership','rent','family','other')),
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  start_date date, end_date date, confirmed_by uuid references person(id), confirmed_at timestamptz,
  revoked_reason text, created_by uuid references person(id), created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index if not exists connection_active_uq on connection(person_id,premises_id) where status='active';
create index if not exists connection_premises_idx on connection(premises_id);
create index if not exists connection_person_idx on connection(person_id);
create table if not exists invite (
  id uuid primary key default gen_random_uuid(), created_by uuid not null references person(id),
  premises_id uuid not null references premises(id), role text not null check (role in ('tenant','resident','other')),
  token text not null unique, expires_at timestamptz not null,
  used_at timestamptz, used_by_profile uuid references profile(id),
  status text not null default 'active' check (status in ('active','used','expired','revoked')),
  created_at timestamptz not null default now()
);
create index if not exists invite_premises_idx on invite(premises_id);
create index if not exists invite_creator_idx on invite(created_by);
create table if not exists registration (
  id uuid primary key default gen_random_uuid(), person_id uuid references person(id),
  draft jsonb not null, premises_id uuid not null references premises(id),
  role text not null check (role in ('owner','tenant','resident','other')),
  source text not null check (source in ('bot','admin','import')), telegram_user_id bigint,
  state text not null default 'pending_review' check (state in ('pending_review','need_clarification','approved','rejected','disputed','withdrawn')),
  checker_id uuid references person(id), dispute_of uuid references registration(id),
  decided_at timestamptz, decided_reason text,
  review_stage text not null default 'administrator' check (review_stage in ('owner','administrator','deputy','chairman')),
  stage_due_at timestamptz, total_due_at timestamptz, overdue_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists registration_queue_idx on registration(state,stage_due_at);
create index if not exists registration_person_idx on registration(person_id);
create index if not exists registration_premises_idx on registration(premises_id);
create table if not exists import_batch (
  id uuid primary key default gen_random_uuid(), created_by uuid not null references person(id),
  state text not null default 'uploaded' check (state in ('uploaded','validating','ready','invalid','committed')),
  payload jsonb not null, errors jsonb not null default '[]', preview jsonb not null default '{}',
  created_at timestamptz not null default now(), committed_at timestamptz
);
create index if not exists import_batch_creator_idx on import_batch(created_by);
create table if not exists import_mapping (
  batch_id uuid not null references import_batch(id), entity_type text not null,
  source_key text not null, entity_id uuid not null, primary key(batch_id,entity_type,source_key)
);
create table if not exists bot_inbound (
  update_id bigint primary key, payload jsonb not null, received_at timestamptz not null default now(),
  processed_at timestamptz
);
create table if not exists bot_dialog (
  telegram_user_id bigint primary key, state jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists notification (
  id uuid primary key default gen_random_uuid(), telegram_user_id bigint not null,
  text text not null, dedup_key text not null unique,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  last_error text, sent_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists notification_queue_idx on notification(state,next_attempt_at);
create table if not exists time_rule (
  id uuid primary key default gen_random_uuid(), key text not null unique
);
create table if not exists time_rule_version (
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references time_rule(id),
  version integer not null, params jsonb not null, created_at timestamptz not null default now(),
  unique(rule_id,version)
);
create table if not exists timer (
  id uuid primary key default gen_random_uuid(), rule_version_id uuid not null references time_rule_version(id),
  entity_id uuid not null, stage text not null, due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','fired','canceled')),
  fired_at timestamptz, unique(entity_id,stage)
);
create index if not exists timer_due_idx on timer(due_at) where state='pending';
insert into time_rule(key) values ('invite_expiry'),('tenant_wait'),('registration_stage'),('dispute_total') on conflict do nothing;
insert into time_rule_version(rule_id,version,params)
select id,1,case key
 when 'invite_expiry' then '{"hours":72,"clock":"calendar"}'::jsonb
 when 'tenant_wait' then '{"hours":48,"clock":"calendar"}'::jsonb
 when 'registration_stage' then '{"hours":12,"clock":"working","timezone":"Asia/Almaty","start":8,"end":20}'::jsonb
 else '{"hours":36,"clock":"working","timezone":"Asia/Almaty","start":8,"end":20}'::jsonb end
from time_rule on conflict do nothing;
-- Таблицы public закрыты от прямого REST-доступа; PDP в API/webhook.
do $$ declare t text; begin
  foreach t in array array['building_parking','premises','connection','invite','registration','import_batch','import_mapping','bot_inbound','bot_dialog','notification','time_rule','time_rule_version','timer'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
  end loop;
end $$;
-- REG-09: происхождение предварительной карточки и основание обработки сохраняются.
alter table person add column if not exists data_source text;
alter table person add column if not exists processing_basis text;
-- Изоляция эмуляции до появления person_id и для объектов, создаваемых симулятором.
alter table registration add column if not exists is_test boolean not null default false;
alter table premises add column if not exists is_test boolean not null default false;
alter table registration add column if not exists dispute_checker_id uuid references person(id);
alter table registration add column if not exists connection_id uuid references connection(id);
-- Расширяемый конверт уведомления: неизвестному заявителю достаточно Telegram,
-- после привязки сохраняется person; симулятор никогда не отправляет наружу.
alter table notification add column if not exists recipient_person_id uuid references person(id);
alter table notification add column if not exists event_type text not null default 'registration';
alter table notification add column if not exists event_ref jsonb not null default '{}';
alter table notification add column if not exists channel text not null default 'telegram' check(channel in ('telegram','simulator'));
alter table bot_inbound add column if not exists status text not null default 'received' check(status in ('received','processed','error'));
alter table bot_inbound add column if not exists error text;
alter table bot_dialog add column if not exists profile_id uuid references profile(id);
