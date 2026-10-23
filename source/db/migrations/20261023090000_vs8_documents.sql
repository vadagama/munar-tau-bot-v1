-- WRK-17/18, DOC-01/03, ADR-018. Файл миграции атомарно исполняется runner-ом.
create table if not exists document (
 id uuid primary key default gen_random_uuid(), title text not null check(length(btrim(title)) between 1 and 10000),
 kind text not null check(kind in ('act','work_report','invoice','receipt','decision_basis','instruction','financial_report','other')),
 audience text not null check(audience in ('resident','owner','staff','finance','service')),
 document_number text, document_date date not null, parties text not null default '',
 request_id uuid references request(id), task_id uuid references task(id),
 prepared_by uuid not null references person(id), reviewer_id uuid not null references person(id),
 created_by uuid not null references person(id), created_at timestamptz not null default now(),
 is_test boolean not null, version integer not null default 1 check(version>0),
 published_version_id uuid,
 check(num_nonnulls(request_id,task_id)<=1),
 check(kind not in ('invoice','receipt') or audience='finance')
);
create index if not exists document_request on document(request_id);
create index if not exists document_task on document(task_id);
create index if not exists document_preparer on document(prepared_by);
create index if not exists document_reviewer on document(reviewer_id);
create index if not exists document_creator on document(created_by);
create index if not exists document_list on document(is_test,created_at desc,id);
create table if not exists document_scope (
 document_id uuid not null references document(id), building_id uuid not null references building(id) on delete cascade,
 primary key(document_id,building_id)
);
create index if not exists document_scope_building on document_scope(building_id);
create table if not exists document_version (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references document(id),
 version integer not null check(version>0),
 task_report_id uuid references task_report(id),
 state text not null default 'draft' check(state in ('draft','on_review','returned','approved','needs_fix')),
 attachment_id uuid not null references attachment(id), signed_attachment_id uuid references attachment(id),
 signature_method text, signature_basis text,
 prepared_by uuid not null references person(id), reviewed_by uuid references person(id),
 review_comment text, created_at timestamptz not null default now(), reviewed_at timestamptz,
 was_published boolean not null default false,
 unique(document_id,version), unique(document_id,id), unique(attachment_id), unique(signed_attachment_id),
 check(signed_attachment_id is null or (signed_attachment_id<>attachment_id and
   length(btrim(signature_method))>0 and length(btrim(signature_basis))>0 and signature_method is not null and signature_basis is not null))
);
create index if not exists document_version_preparer on document_version(prepared_by);
create index if not exists document_version_report on document_version(task_report_id);
create index if not exists document_version_reviewer on document_version(reviewed_by);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='document_published_version_fk' and conrelid='document'::regclass) then
  alter table document add constraint document_published_version_fk foreign key(id,published_version_id) references document_version(document_id,id);
 end if;
end $$;
create table if not exists document_log (
 id bigserial primary key, document_id uuid not null references document(id),
 document_version_id uuid references document_version(id), action text not null,
 actor_person_id uuid not null references person(id), reason text not null,
 at timestamptz not null default now()
);
create index if not exists document_log_document on document_log(document_id,id);
create index if not exists document_log_version on document_log(document_version_id);
create index if not exists document_log_actor on document_log(actor_person_id);
create or replace function protect_document_version() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'document version is immutable'; end if;
 if (to_jsonb(new)-array['state','reviewed_by','review_comment','reviewed_at','was_published'])
  is distinct from (to_jsonb(old)-array['state','reviewed_by','review_comment','reviewed_at','was_published']) then
  raise exception 'document version content is immutable';
 end if;
 if old.was_published and not new.was_published then raise exception 'publication history is immutable'; end if;
 if new.state<>old.state and not (
  (old.state='draft' and new.state='on_review') or
  (old.state='on_review' and new.state in ('approved','returned')) or
  (old.state='approved' and new.state='needs_fix')
 ) then raise exception 'invalid document version transition'; end if;
 return new;
end $$;
drop trigger if exists document_version_immutable on document_version;
create trigger document_version_immutable before update or delete on document_version for each row execute function protect_document_version();
create or replace function protect_document_log() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'document history is append-only'; end $$;
drop trigger if exists document_log_immutable on document_log;
create trigger document_log_immutable before update or delete on document_log for each row execute function protect_document_log();
revoke execute on function protect_document_version(),protect_document_log() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['document','document_scope','document_version','document_log'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from anon,authenticated',t);
 end loop;
end $$;
revoke all on sequence document_log_id_seq from anon,authenticated;
