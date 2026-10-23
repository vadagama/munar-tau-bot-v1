-- FIN-01…04: версии внешнего финансового отчёта в существующем publications.
-- Форма, основания, сроки и каналы задаются ОСИ, демонстрационных нормативов нет.
create table if not exists financial_rule (
 id uuid primary key default gen_random_uuid(), name text not null, definition jsonb not null,
 version integer not null default 1 check(version>0), active boolean not null default true,
 is_test boolean not null, created_by uuid not null references person(id), created_at timestamptz not null default now()
);
create table if not exists financial_rule_version (
 id uuid primary key default gen_random_uuid(), rule_id uuid not null references financial_rule(id),
 version integer not null check(version>0), definition jsonb not null, reason text not null check(length(btrim(reason))>0),
 created_by uuid not null references person(id), created_at timestamptz not null default now(), unique(rule_id,version)
);
create table if not exists financial_obligation (
 id uuid primary key default gen_random_uuid(), financial_rule_version_id uuid not null references financial_rule_version(id),
 period_from date not null, period_to date not null, building_ids uuid[] not null check(cardinality(building_ids)>0),
 prepared_by uuid not null references person(id), reviewer_id uuid not null references person(id), publisher_id uuid not null references person(id),
 time_rule_version_id uuid not null references time_rule_version(id), rule_snapshot jsonb not null, due_at timestamptz not null,
 publication_id uuid references publication(id), active_version_id uuid, completed_at timestamptz,
 reminded_at timestamptz, escalated_at timestamptz, version integer not null default 1 check(version>0),
 is_test boolean not null, created_by uuid not null references person(id), created_at timestamptz not null default now(),
 check(period_to>=period_from), check(prepared_by<>reviewer_id), check(active_version_id is null or publication_id is not null), unique(id,publication_id),
 unique(financial_rule_version_id,period_from,period_to,building_ids)
);
create table if not exists financial_publication_version (
 id uuid primary key default gen_random_uuid(), publication_id uuid not null references publication(id),
 version integer not null check(version>0), obligation_id uuid not null references financial_obligation(id),
 period_from date not null, period_to date not null, report_version_id uuid not null references document_version(id),
 title text not null, body text not null, building_ids uuid[] not null check(cardinality(building_ids)>0),
 correction_note text not null default '', package_snapshot jsonb not null,
 approval_id uuid, published_at timestamptz, replaced_at timestamptz,
 created_by uuid not null references person(id), created_at timestamptz not null default now(),
 check(period_to>=period_from), check(published_at is null or approval_id is not null), check(replaced_at is null or published_at is not null),
 unique(publication_id,version), unique(publication_id,id), unique(obligation_id,id), unique(obligation_id,publication_id,id),
 foreign key(obligation_id,publication_id) references financial_obligation(id,publication_id)
);
create table if not exists financial_publication_approval (
 id uuid primary key default gen_random_uuid(), financial_version_id uuid not null references financial_publication_version(id),
 actor_person_id uuid not null references person(id), note text not null check(length(btrim(note))>0),
 snapshot jsonb not null, created_at timestamptz not null default now(), unique(financial_version_id,id)
);
create table if not exists financial_package_document (
 financial_version_id uuid not null references financial_publication_version(id), document_version_id uuid not null references document_version(id),
 code text not null, disclosed boolean not null default false,
 primary key(financial_version_id,document_version_id), unique(financial_version_id,code)
);
create table if not exists financial_placement (
 id uuid primary key default gen_random_uuid(), obligation_id uuid not null references financial_obligation(id),
 financial_version_id uuid not null references financial_publication_version(id), channel text not null check(length(btrim(channel))>0),
 placed_at timestamptz not null, evidence text not null check(length(btrim(evidence))>0), proof_version_id uuid references document_version(id),
 reason text not null check(length(btrim(reason))>0), actor_person_id uuid not null references person(id), created_at timestamptz not null default now(),
 foreign key(obligation_id,financial_version_id) references financial_publication_version(obligation_id,id)
);
create table if not exists financial_issue (
 id uuid primary key default gen_random_uuid(), financial_version_id uuid not null references financial_publication_version(id),
 document_version_id uuid not null references document_version(id), created_at timestamptz not null default now(), resolved_at timestamptz,
 unique(financial_version_id,document_version_id)
);
-- Документозависимые обычные публикации тоже используют проверяемые версии.
create table if not exists publication_document (
 publication_id uuid not null references publication(id), document_version_id uuid not null references document_version(id),
 primary key(publication_id,document_version_id)
);
alter table publication add column if not exists financial_version_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='publication_financial_version_fk') then
  alter table publication add constraint publication_financial_version_fk foreign key(id,financial_version_id) references financial_publication_version(publication_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='financial_version_approval_fk') then
  alter table financial_publication_version add constraint financial_version_approval_fk foreign key(id,approval_id) references financial_publication_approval(financial_version_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='financial_obligation_active_version_fk') then
  alter table financial_obligation add constraint financial_obligation_active_version_fk foreign key(id,publication_id,active_version_id) references financial_publication_version(obligation_id,publication_id,id);
 end if;
end $$;

create or replace function protect_financial_history() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'financial history is append-only'; end $$;
create or replace function protect_financial_version() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['approval_id','published_at','replaced_at']) is distinct from (to_jsonb(old)-array['approval_id','published_at','replaced_at']) then
  raise exception 'financial version content is immutable';
 end if;
 if old.published_at is not null and (new.published_at is distinct from old.published_at or new.approval_id is distinct from old.approval_id) then
  raise exception 'published financial approval is immutable';
 end if;
 if old.replaced_at is not null and new.replaced_at is distinct from old.replaced_at then raise exception 'replacement history is immutable'; end if;
 return new;
end $$;
create or replace function protect_financial_obligation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['prepared_by','reviewer_id','publisher_id','publication_id','active_version_id','completed_at','reminded_at','escalated_at','version'])
   is distinct from (to_jsonb(old)-array['prepared_by','reviewer_id','publisher_id','publication_id','active_version_id','completed_at','reminded_at','escalated_at','version']) then
  raise exception 'financial obligation terms are immutable';
 end if;
 if old.publication_id is not null and new.publication_id is distinct from old.publication_id then raise exception 'financial obligation publication is immutable'; end if;
 return new;
end $$;
create or replace function protect_financial_package_insert() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v financial_publication_version%rowtype;
begin
 select * into v from financial_publication_version where id=new.financial_version_id for update;
 if v.approval_id is not null or v.published_at is not null then raise exception 'approved financial package is immutable'; end if;
 return new;
end $$;
create or replace function protect_publication_document() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare s text;
begin
 if tg_op='UPDATE' then raise exception 'replace draft document association explicitly'; end if;
 select state into s from publication where id=case when tg_op='DELETE' then old.publication_id else new.publication_id end for update;
 if s not in ('draft','pending_approval') then raise exception 'released publication documents are immutable'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['financial_rule_version','financial_publication_approval','financial_package_document','financial_placement'] loop
  execute format('drop trigger if exists financial_history_immutable on %I',t);
  execute format('create trigger financial_history_immutable before update or delete on %I for each row execute function protect_financial_history()',t);
 end loop;
 foreach t in array array['financial_rule','financial_rule_version','financial_obligation','financial_publication_version','financial_publication_approval','financial_package_document','financial_placement','financial_issue','publication_document'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from anon,authenticated',t);
 end loop;
end $$;
drop trigger if exists financial_version_immutable on financial_publication_version;
create trigger financial_version_immutable before update or delete on financial_publication_version for each row execute function protect_financial_version();
drop trigger if exists financial_obligation_terms on financial_obligation;
create trigger financial_obligation_terms before update or delete on financial_obligation for each row execute function protect_financial_obligation();
drop trigger if exists financial_package_insert_guard on financial_package_document;
create trigger financial_package_insert_guard before insert on financial_package_document for each row execute function protect_financial_package_insert();
drop trigger if exists publication_document_guard on publication_document;
create trigger publication_document_guard before insert or update or delete on publication_document for each row execute function protect_publication_document();
revoke execute on function protect_financial_history(),protect_financial_version(),protect_financial_obligation(),protect_financial_package_insert(),protect_publication_document() from public,anon,authenticated;

create index if not exists financial_rule_creator on financial_rule(created_by);
create index if not exists financial_rule_version_creator on financial_rule_version(created_by);
create index if not exists financial_obligation_rule on financial_obligation(financial_rule_version_id);
create index if not exists financial_obligation_preparer on financial_obligation(prepared_by);
create index if not exists financial_obligation_reviewer on financial_obligation(reviewer_id);
create index if not exists financial_obligation_publisher on financial_obligation(publisher_id);
create index if not exists financial_obligation_timing on financial_obligation(time_rule_version_id);
create index if not exists financial_obligation_publication on financial_obligation(publication_id);
create index if not exists financial_obligation_active on financial_obligation(active_version_id);
create index if not exists financial_obligation_creator on financial_obligation(created_by);
create index if not exists financial_obligation_due on financial_obligation(due_at,id) where completed_at is null;
create index if not exists financial_version_obligation on financial_publication_version(obligation_id);
create index if not exists financial_version_report on financial_publication_version(report_version_id);
create index if not exists financial_version_approval on financial_publication_version(approval_id);
create index if not exists financial_version_creator on financial_publication_version(created_by);
create index if not exists financial_approval_actor on financial_publication_approval(actor_person_id);
create index if not exists financial_package_version on financial_package_document(document_version_id);
create index if not exists financial_placement_version on financial_placement(financial_version_id);
create index if not exists financial_placement_obligation on financial_placement(obligation_id,financial_version_id,channel,created_at desc);
create index if not exists financial_placement_proof on financial_placement(proof_version_id);
create index if not exists financial_placement_actor on financial_placement(actor_person_id);
create index if not exists financial_issue_document on financial_issue(document_version_id);
create index if not exists publication_document_version on publication_document(document_version_id);
create index if not exists publication_financial_version on publication(financial_version_id);
insert into time_rule(key) values('financial_monthly_publication'),('financial_annual_publication') on conflict do nothing;
