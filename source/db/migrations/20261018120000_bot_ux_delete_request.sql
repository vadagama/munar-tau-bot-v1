-- PRV-02: запросы на удаление профиля/отзыв согласия (LLD-02 §2.9).
-- Решение принимает администратор самостоятельно; история действий —
-- append-only audit_log. Доступ к таблице — только через Edge API/PDP.
create table if not exists privacy_request (
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references person(id),
 kind text not null check(kind in ('delete_profile','withdraw_consent','data_export')),
 state text not null default 'received' check(state in ('received','reviewing','resolved')),
 resolution jsonb not null default '{}',
 decided_by uuid references person(id),
 decided_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists privacy_request_person on privacy_request(person_id,state);
alter table privacy_request enable row level security;
revoke all on privacy_request from anon,authenticated;
