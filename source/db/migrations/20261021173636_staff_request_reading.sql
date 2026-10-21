-- Personal receipts acknowledge only explicitly displayed incoming messages.
create table if not exists request_message_read (
  person_id uuid not null references person(id),
  message_id uuid not null references message(id),
  read_at timestamptz not null default now(),
  primary key(person_id,message_id)
);
create index if not exists request_message_read_message on request_message_read(message_id);
alter table request_message_read enable row level security;
revoke all on request_message_read from anon,authenticated;
