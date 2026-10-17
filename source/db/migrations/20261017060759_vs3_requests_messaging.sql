-- VS-3: REQ, SHR, MSG, RAT, FIL. Клиенты используют только Edge API.
create table if not exists request_category (
 id uuid primary key default gen_random_uuid(), name_ru text not null, name_kk text not null,
 sort integer not null default 0, active boolean not null default true
);
insert into request_category(id,name_ru,name_kk,sort) values
 ('33333333-3333-4333-8333-333333333301','Водоснабжение/канализация','Су/кәріз',1),
 ('33333333-3333-4333-8333-333333333302','Отопление','Жылыту',2),
 ('33333333-3333-4333-8333-333333333303','Электрика/освещение','Электр/жарық',3),
 ('33333333-3333-4333-8333-333333333304','Уборка','Тазалау',4),
 ('33333333-3333-4333-8333-333333333305','Территория/благоустройство','Аумақ/абаттандыру',5),
 ('33333333-3333-4333-8333-333333333306','Конструкции/кровля','Құрылымдар/шатыр',6),
 ('33333333-3333-4333-8333-333333333307','Доступ/общее оборудование','Кіру/ортақ жабдық',7),
 ('33333333-3333-4333-8333-333333333308','Прочее/требует классификации','Басқа/жіктеу қажет',8)
on conflict(id) do nothing;
create table if not exists number_sequence(key text,year integer,seq bigint not null,primary key(key,year));
create table if not exists request (
 id uuid primary key default gen_random_uuid(), number text unique,
 kind text not null default 'request' check(kind in ('request','question','complaint')),
 category_id uuid references request_category(id), urgency text not null default 'normal' check(urgency in ('low','normal','high','critical')),
 state text not null default 'draft' check(state in ('draft','new','reviewing','need_clarification','in_work','on_hold','awaiting_confirmation','rework','closed','canceled','rejected')),
 author_person_id uuid not null references person(id), created_by uuid not null references person(id),
 premises_id uuid references premises(id), building_id uuid references building(id), location_text text,
 source text not null check(source in ('bot','admin','web','phone','personal','whatsapp')),
 description text not null, is_test boolean not null,
 assigned_admin_person_id uuid references person(id), complaint_subject_person_id uuid references person(id),
 prev_state text, clarification_question text, hold_reason text, next_action_at timestamptz,
 first_response_due_at timestamptz, first_response_at timestamptz, due_at timestamptz, overdue_since timestamptz, open_at timestamptz,
 close_method text check(close_method in ('author','administrative')), closed_at timestamptz, closed_by uuid references person(id),
 cancel_request jsonb, reject_reason text, appeal_by_chairman jsonb, work_started_at timestamptz,
 confirmation_version integer not null default 0, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((state='draft' and number is null) or (state<>'draft' and number is not null))
);
create unique index if not exists request_one_draft on request(author_person_id) where state='draft';
create index if not exists request_scope_state on request(building_id,state,created_at);
create index if not exists request_author on request(author_person_id,created_at);
create table if not exists request_participant (
 request_id uuid not null references request(id), person_id uuid not null references person(id),
 role text not null check(role in ('author','participant','payer')), added_by uuid not null references person(id),
 added_at timestamptz not null default now(), revoked_at timestamptz, primary key(request_id,person_id)
);
create index if not exists request_participant_person on request_participant(person_id) where revoked_at is null;
create table if not exists message (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references request(id),
 channel text not null check(channel in ('resident','internal')), author_person_id uuid not null references person(id),
 text text not null, reply_to uuid references message(id), corrects_message_id uuid references message(id),
 restricted_at timestamptz, restricted_reason text, restricted_by uuid references person(id),
 source text not null default 'web', created_at timestamptz not null default now()
);
create index if not exists message_request_channel on message(request_id,channel,created_at);
create table if not exists attachment (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references request(id),
 owner_type text not null check(owner_type in ('message','request')), owner_id uuid not null,
 bucket text not null check(bucket in ('resident','internal')), storage_path text not null unique,
 filename text not null, size_bytes integer not null check(size_bytes between 1 and 20971520), mime text not null,
 status text not null default 'incomplete' check(status in ('complete','incomplete')),
 uploaded_by uuid not null references person(id), created_at timestamptz not null default now()
);
create index if not exists attachment_owner on attachment(owner_type,owner_id);
create index if not exists attachment_request on attachment(request_id);
create table if not exists request_log (
 id bigserial primary key, request_id uuid not null references request(id), from_state text, to_state text not null,
 actor_person_id uuid not null references person(id), actor_role text not null, reason text,
 meta jsonb not null default '{}', at timestamptz not null default now()
);
create index if not exists request_log_request on request_log(request_id,at);
create table if not exists request_confirmation (
 request_id uuid not null references request(id), version integer not null, payload jsonb not null,
 sent_at timestamptz not null default now(), confirmed_at timestamptz, confirmed_by uuid references person(id),
 superseded_at timestamptz, primary key(request_id,version)
);
create table if not exists rating (
 id uuid primary key default gen_random_uuid(), request_id uuid unique not null references request(id),
 value integer not null check(value between 1 and 5), comment text, person_id uuid not null references person(id),
 confirmation_version integer not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), withdrawn_at timestamptz
);
create table if not exists rating_log (
 id bigserial primary key, request_id uuid not null references request(id), person_id uuid not null references person(id),
 value integer not null check(value between 1 and 5), comment text, confirmation_version integer not null, at timestamptz not null default now()
);
create table if not exists idempotency_key (
 key text not null, endpoint text not null, request_hash text not null, response jsonb, status integer,
 created_at timestamptz not null default now(), primary key(key,endpoint)
);
create table if not exists outbox (
 id bigserial primary key,event_type text not null,payload jsonb not null,
 created_at timestamptz not null default now(),processed_at timestamptz,attempts integer not null default 0
);
create index if not exists outbox_pending on outbox(id) where processed_at is null;
-- MSG-03: неизменяемые авторство/канал/текст; ограничение доступа отдельными полями.
create or replace function protect_message_history() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception 'message history is immutable'; end if;
 if (new.request_id,new.channel,new.author_person_id,new.text,new.reply_to,new.corrects_message_id,new.created_at)
 is distinct from (old.request_id,old.channel,old.author_person_id,old.text,old.reply_to,old.corrects_message_id,old.created_at)
 then raise exception 'message history is immutable'; end if;
 return new;
end $$;
drop trigger if exists message_history_immutable on message;
create trigger message_history_immutable before update or delete on message for each row execute function protect_message_history();
create or replace function protect_request_history() returns trigger language plpgsql as $$
begin
 if (new.description,new.author_person_id,new.created_by,new.source,new.is_test)
 is distinct from (old.description,old.author_person_id,old.created_by,old.source,old.is_test) and old.state<>'draft'
 then raise exception 'request original history is immutable'; end if;
 return new;
end $$;
drop trigger if exists request_history_immutable on request;
create trigger request_history_immutable before update on request for each row execute function protect_request_history();
-- Регистрируемые журналы append-only; truncate нужен исключительно тестовому владельцу.
create or replace function protect_request_log() returns trigger language plpgsql as $$
begin raise exception 'request log is append-only'; end $$;
drop trigger if exists request_log_immutable on request_log;
create trigger request_log_immutable before update or delete on request_log for each row execute function protect_request_log();
drop trigger if exists rating_log_immutable on rating_log;
create trigger rating_log_immutable before update or delete on rating_log for each row execute function protect_request_log();
-- Отзыв SHR синхронен с отзывом связи, включая внешние изменения связи.
create or replace function revoke_request_shares() returns trigger language plpgsql as $$
begin
 if old.status='active' and new.status<>'active' then
 update request_participant p set revoked_at=now() from request r
 where p.request_id=r.id and r.premises_id=new.premises_id and p.role='participant'
 and (p.person_id=new.person_id or r.author_person_id=new.person_id) and p.revoked_at is null;
 end if;
 return new;
end $$;
drop trigger if exists connection_revoke_request_shares on connection;
create trigger connection_revoke_request_shares after update on connection for each row execute function revoke_request_shares();
-- Заслон, как в VS-1/2. Таблицы недоступны напрямую через PostgREST.
do $$ declare t text; begin
 foreach t in array array['request_category','number_sequence','request','request_participant','message','attachment','request_log','request_confirmation','rating','rating_log','idempotency_key','outbox'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
revoke execute on function protect_message_history(),protect_request_history(),protect_request_log(),revoke_request_shares() from public,anon,authenticated;
insert into time_rule(key) values ('first_response'),('request_reopen'),('request_admin_close_wait') on conflict do nothing;
insert into time_rule_version(rule_id,version,params)
select id,1,case key when 'first_response' then '{"hours":2,"clock":"working","timezone":"Asia/Almaty","start":8,"end":20}'::jsonb
 when 'request_reopen' then '{"hours":168,"clock":"calendar"}'::jsonb
 else '{"hours":48,"clock":"calendar"}'::jsonb end
from time_rule where key in ('first_response','request_reopen','request_admin_close_wait') on conflict(rule_id,version) do nothing;
-- Private Storage, без политик чтения/записи для клиентов.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('files-resident','files-resident',false,20971520,null),('files-internal','files-internal',false,20971520,null)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
create table if not exists request_upload_job (
 attachment_id uuid primary key references attachment(id),telegram_file_id text not null,person_id uuid not null references person(id),
 state text not null default 'queued' check(state in ('queued','processing','complete','failed')),
 attempts integer not null default 0,lease_until timestamptz,last_error text,created_at timestamptz not null default now()
);
create index if not exists request_upload_job_queue on request_upload_job(state,created_at) where state in ('queued','processing');
alter table request_upload_job enable row level security;
revoke all on request_upload_job from anon,authenticated;
-- Неизменяемый снимок результата; изменяются только отметки принятия/отзыва.
create or replace function protect_confirmation_snapshot() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception 'confirmation snapshot is immutable'; end if;
 if (new.request_id,new.version,new.payload,new.sent_at) is distinct from (old.request_id,old.version,old.payload,old.sent_at)
 then raise exception 'confirmation snapshot is immutable'; end if;
 return new;
end $$;
drop trigger if exists confirmation_snapshot_immutable on request_confirmation;
create trigger confirmation_snapshot_immutable before update or delete on request_confirmation for each row execute function protect_confirmation_snapshot();
revoke execute on function protect_confirmation_snapshot() from public,anon,authenticated;
alter table attachment add column if not exists upload_expires_at timestamptz not null default (now()+interval '5 minutes');
create table if not exists api_rate_limit(profile_id uuid primary key references profile(id),window_at timestamptz not null,count integer not null);
alter table api_rate_limit enable row level security;
revoke all on api_rate_limit from anon,authenticated;
alter table request add column if not exists work_execution_required boolean not null default false;
alter table request add column if not exists reopen_until timestamptz;
alter table request add column if not exists next_action_reminded_at timestamptz;
alter table request_confirmation add column if not exists admin_close_after timestamptz;
create table if not exists file_policy (
 singleton boolean primary key default true check(singleton),max_bytes integer not null check(max_bytes between 1 and 20971520),
 max_per_message integer not null check(max_per_message between 1 and 10),extensions text[] not null
);
insert into file_policy(singleton,max_bytes,max_per_message,extensions)
values(true,20971520,10,array['jpg','jpeg','png','webp','heic','mp4','mov','webm','pdf','zip','7z','rar','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp']) on conflict do nothing;
alter table file_policy enable row level security;
revoke all on file_policy from anon,authenticated;
alter table request add column if not exists complaint_route text not null default 'administrator' check(complaint_route in ('administrator','chairman'));
