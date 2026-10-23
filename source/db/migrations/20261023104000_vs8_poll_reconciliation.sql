-- POL-03: отдельный курсор ротации, без изменения версии опроса/личных форм.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.poll_reconciliation (
 poll_id uuid primary key references public.poll(id),
 checked_at timestamptz not null
);
create index if not exists poll_reconciliation_checked on public.poll_reconciliation(checked_at,poll_id);
alter table public.poll_reconciliation enable row level security;
revoke all on public.poll_reconciliation from public,anon,authenticated;
