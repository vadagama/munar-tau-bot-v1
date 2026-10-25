-- ADR-022. One row per profile; current calendar day in Almaty.
-- Application backend is the only reader/writer. No client policies.
create table dashboard_ai_quota (
  profile_id uuid primary key references profile(id) on delete cascade,
  day date not null,
  used integer not null check (used between 1 and 20)
);
alter table dashboard_ai_quota enable row level security;
revoke all on dashboard_ai_quota from public, anon, authenticated;
-- Rollback after disabling AI: drop table dashboard_ai_quota;
