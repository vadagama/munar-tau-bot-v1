-- ADR-017: old bot_dialog remains a rollback snapshot; transient input is reset.
create table if not exists bot_dialog_channel (
  bot text not null check (bot in ('resident','worker')),
  telegram_user_id bigint not null,
  profile_id uuid references profile(id),
  context_id text,
  format_version integer not null default 1,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now(),
  primary key (bot,telegram_user_id)
);
create index if not exists bot_dialog_channel_profile on bot_dialog_channel(profile_id);
alter table bot_dialog_channel enable row level security;
revoke all on bot_dialog_channel from anon,authenticated;
