-- AI-ассистент кабинета (ADR-021, план S0.2): singleton настроек с единым
-- токеном провайдера, per-user конфиги (kill switch — выключен у всех по
-- умолчанию) и append-only ledger расхода токенов с идемпотентностью по
-- operation_id. День/месяц расхода — по Asia/Almaty (граница суток 05:00 → 05:00).
--
-- RLS по принципам db/rls.sql: политик для anon/authenticated нет — прямой
-- запрос из браузера не возвращает ни одной строки; доступ только через API
-- (service_role). «Владелец + privileged» для config/ledger и «только
-- privileged» для settings строятся в PDP ядра (assistant.*), не в RLS.
create table if not exists public.assistant_settings (
  id int primary key default 1 check (id = 1),
  provider text not null,
  base_url text not null,
  model_id text not null,
  api_key_encrypted text,
  api_key_mask text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.assistant_settings(id,provider,base_url,model_id)
  values (1,'deepseek','https://api.deepseek.com/v1','deepseek-chat')
  on conflict (id) do nothing;

create table if not exists public.assistant_user_config (
  profile_id uuid primary key references public.profile(id) on delete cascade,
  enabled boolean not null default false,
  daily_token_limit int not null default 0 check (daily_token_limit >= 0),
  monthly_token_limit int not null default 0 check (monthly_token_limit >= 0),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  check (enabled = false or (daily_token_limit > 0 and monthly_token_limit > 0))
);

create table if not exists public.assistant_usage_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profile(id) on delete cascade,
  operation_id text not null,
  prompt_tokens int not null check (prompt_tokens >= 0),
  completion_tokens int not null check (completion_tokens >= 0),
  usage_day date not null default (now() at time zone 'Asia/Almaty')::date,
  usage_month date not null default (date_trunc('month', now() at time zone 'Asia/Almaty'))::date,
  recorded_at timestamptz not null default now()
);
create unique index if not exists assistant_usage_ledger_operation
  on public.assistant_usage_ledger(operation_id);
create index if not exists assistant_usage_ledger_profile_month
  on public.assistant_usage_ledger(profile_id, usage_month, usage_day);

alter table public.assistant_settings enable row level security;
alter table public.assistant_user_config enable row level security;
alter table public.assistant_usage_ledger enable row level security;
revoke all on public.assistant_settings, public.assistant_user_config,
  public.assistant_usage_ledger from public,anon,authenticated;

-- Ledger append-only: UPDATE/DELETE запрещены на уровне БД (errcode 42501,
-- как audience_history_immutable). Повтор operation_id отсекается уникальным
-- индексом, а не правкой строки.
create or replace function public.assistant_usage_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'assistant_usage_ledger is append-only' using errcode='42501'; end $$;
drop trigger if exists assistant_usage_immutable on public.assistant_usage_ledger;
create trigger assistant_usage_immutable before update or delete
  on public.assistant_usage_ledger for each statement
  execute function public.assistant_usage_immutable();
revoke all on function public.assistant_usage_immutable() from public,anon,authenticated;
