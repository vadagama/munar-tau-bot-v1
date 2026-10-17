-- Глобальная настройка, общая для настоящих и тестовых персон; запись кабинет-only.
create table if not exists message_template (
 id uuid primary key default gen_random_uuid(), key text not null unique, created_at timestamptz not null default now()
);
create table if not exists message_template_version (
 id uuid primary key default gen_random_uuid(), template_id uuid not null references message_template(id),
 version integer not null check(version>0), text_ru text, text_kk text, use_default boolean not null default false,
 reason text not null check(length(trim(reason))>0), created_by uuid not null references person(id), created_at timestamptz not null default now(),
 unique(template_id,version),
 check((use_default and text_ru is null and text_kk is null) or (not use_default and length(trim(text_ru))>0 and length(trim(text_kk))>0 and text_ru is not null and text_kk is not null)),
 check(length(text_ru)<=4000 and length(text_kk)<=4000)
);
create or replace function protect_message_template_version() returns trigger language plpgsql as $$
begin raise exception 'message_template_version is append-only'; end $$;
drop trigger if exists message_template_version_immutable on message_template_version;
create trigger message_template_version_immutable before update or delete on message_template_version for each row execute function protect_message_template_version();
do $$ declare t text; begin
 foreach t in array array['message_template','message_template_version'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated',t);
 end loop;
end $$;
