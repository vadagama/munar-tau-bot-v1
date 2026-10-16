-- 0003_identity_sessions_audit.sql — VS-1: идентичность, сеансы, аудит-скелет
-- (LLD-02 §2.1–2.2, 2.3, 2.6, 13; RLS — §16; append-only — §17).
--
-- person/profile/staff_assignment/staff_scope по плану LLD-05 относились к VS-2,
-- но Actor, access_session, audit_log и эмуляция ссылаются на них уже в VS-1 —
-- перенос зафиксирован в tasks/plan-vs-1.md. building — каркас для FK staff_scope
-- (полный реестр объектов — VS-2). Остальное (premises, connection, invite,
-- registration, import) остаётся в VS-2.
--
-- Идемпотентно: IF NOT EXISTS + DO-блоки для типов.

-- ── Типы ────────────────────────────────────────────────────────────────────

do $$ begin
  create type person_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type language as enum ('ru', 'kk');
exception when duplicate_object then null; end $$;

do $$ begin
  create type building_kind as enum ('house', 'parking');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_role as enum (
    'administrator', 'deputy', 'chairman', 'tech_admin',
    'duty', 'doc_reviewer', 'finance', 'executor'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type assignment_status as enum ('active', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type emulation_state as enum ('active', 'ended');
exception when duplicate_object then null; end $$;

-- ── Идентичность и полномочия (LLD-02 §2) ──────────────────────────────────

-- 2.1. person — физическое лицо
create table if not exists person (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_e164 text not null unique,
  status person_status not null default 'active',
  is_test boolean not null default false,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.2. profile — привязка Telegram и сеанс Auth
create table if not exists profile (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  telegram_user_id bigint not null unique,
  supabase_user_id uuid,
  language language not null default 'ru',
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- один действующий профиль на человека; архивный профиль освобождает привязки
create unique index if not exists profile_person_active_uq
  on profile(person_id) where archived_at is null;
create unique index if not exists profile_supabase_active_uq
  on profile(supabase_user_id) where archived_at is null;

-- 2.3. building — дома и паркинги (каркас для области полномочий)
create table if not exists building (
  id uuid primary key default gen_random_uuid(),
  kind building_kind not null,
  code text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (kind, code)
);

-- 2.6. staff_assignment — служебные полномочия (ROL-01–04)
create table if not exists staff_assignment (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  role staff_role not null,
  financial_rights boolean not null default false,
  registry_export_rights boolean not null default false,
  regulations_rights boolean not null default false,
  status assignment_status not null default 'active',
  valid_from timestamptz,
  valid_until timestamptz,
  assigned_by uuid references person(id),
  revoked_by uuid references person(id),
  created_at timestamptz not null default now()
);

create index if not exists staff_assignment_person_active_idx
  on staff_assignment(person_id) where status = 'active';

-- staff_scope — область домов; отсутствие строк у активного назначения = весь ОСИ
-- (только chairman/tech_admin — согласовано 16.10.2026)
create table if not exists staff_scope (
  assignment_id uuid not null references staff_assignment(id) on delete cascade,
  building_id uuid not null references building(id),
  primary key (assignment_id, building_id)
);

-- ── Служебные таблицы (LLD-02 §13) ─────────────────────────────────────────

-- access_session: id = session_id из JWT; пределы AUTH-06 — 12 ч / 30 мин
create table if not exists access_session (
  id uuid primary key,
  profile_id uuid not null references profile(id),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_activity_kind text not null default 'start',
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists access_session_profile_idx on access_session(profile_id);

-- emulation_session (HLD 10.8): не более одного активного сеанса на техадмина
create table if not exists emulation_session (
  id uuid primary key default gen_random_uuid(),
  tech_admin_profile_id uuid not null references profile(id),
  emulated_profile_id uuid not null references profile(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  state emulation_state not null default 'active',
  constraint emulation_session_not_self
    check (tech_admin_profile_id <> emulated_profile_id)
);

create unique index if not exists emulation_session_active_uq
  on emulation_session(tech_admin_profile_id) where state = 'active';

-- Синтетические идентификаторы тестовых персон эмуляции (is_test):
-- telegram id отрицательный (у Telegram id положительные), телефон в
-- незанятом диапазоне +700000000000… — реальным данным не соответствует.
create sequence if not exists emulation_test_phone_seq start 1;

-- audit_log (AUD-01): append-only, реальный актор + эмулируемая персона
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_person_id uuid references person(id),
  actor_profile_id uuid references profile(id),
  emulation_session_id uuid references emulation_session(id),
  emulated_person_id uuid references person(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  scope_buildings jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id, at);
create index if not exists audit_log_actor_idx on audit_log(actor_person_id, at);
create index if not exists audit_log_at_idx on audit_log(at desc);

-- ── RLS — второй рубеж (LLD-02 §16): прямого клиентского доступа нет ───────

alter table person            enable row level security;
alter table profile           enable row level security;
alter table building          enable row level security;
alter table staff_assignment  enable row level security;
alter table staff_scope       enable row level security;
alter table access_session    enable row level security;
alter table emulation_session enable row level security;
alter table audit_log         enable row level security;

revoke all on person, profile, building, staff_assignment, staff_scope,
  access_session, emulation_session, audit_log
  from anon, authenticated;

-- ── Append-only audit_log (LLD-02 §17, AUD-01) ─────────────────────────────
-- REVOKE у всех ролей, включая service_role (согласовано 16.10.2026).
-- Владелец таблицы REVOKE обходит — защита дублируется триггером.
-- Полная защита от инфраструктурного доступа — открытая точка Д-7 (AQ-07).

revoke update, delete, truncate on audit_log
  from anon, authenticated, service_role, postgres;

create or replace function audit_log_append_only_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log — append-only: изменение и удаление запрещены (AUD-01)';
end;
$$;

drop trigger if exists audit_log_append_only_rows on audit_log;
create trigger audit_log_append_only_rows
  before update or delete on audit_log
  for each row execute function audit_log_append_only_guard();

drop trigger if exists audit_log_append_only_truncate on audit_log;
create trigger audit_log_append_only_truncate
  before truncate on audit_log
  for each statement execute function audit_log_append_only_guard();
