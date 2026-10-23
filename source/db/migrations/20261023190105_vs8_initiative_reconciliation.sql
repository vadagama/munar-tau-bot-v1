-- IDEA-02: справедливая ротация сверки аудитории без изменения личных форм.
create table if not exists public.initiative_reconciliation (
 initiative_id uuid primary key references public.initiative(id),
 checked_at timestamptz not null
);
alter table public.initiative_reconciliation enable row level security;
revoke all on public.initiative_reconciliation from public,anon,authenticated;
