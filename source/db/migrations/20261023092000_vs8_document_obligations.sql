-- Сроки намеренно без начальных длительностей: их настраивает ОСИ через TIM.
insert into time_rule(key) values('document_prepare'),('document_after_acceptance') on conflict do nothing;
create table if not exists document_obligation (
 id uuid primary key default gen_random_uuid(), request_id uuid references request(id), task_id uuid references task(id),
 kind text not null check(kind in ('act','work_report','invoice','receipt','decision_basis','instruction','financial_report','other')),
 phase text not null check(phase in ('before_acceptance','after_acceptance')),
 basis text not null check(length(btrim(basis))>0),
 prepared_by uuid not null references person(id), reviewer_id uuid not null references person(id),
 signed_required boolean not null default false,
 rule_version_id uuid not null references time_rule_version(id), rule_snapshot jsonb not null,
 due_at timestamptz not null, document_version_id uuid references document_version(id), completed_at timestamptz,
 reminded_at timestamptz, escalated_at timestamptz, version integer not null default 1,
 created_by uuid not null references person(id), created_at timestamptz not null default now(), is_test boolean not null,
 check(num_nonnulls(request_id,task_id)=1), check(version>0), check(prepared_by<>reviewer_id)
);
create index if not exists document_obligation_request on document_obligation(request_id);
create index if not exists document_obligation_task on document_obligation(task_id);
create index if not exists document_obligation_preparer on document_obligation(prepared_by);
create index if not exists document_obligation_reviewer on document_obligation(reviewer_id);
create index if not exists document_obligation_rule on document_obligation(rule_version_id);
create index if not exists document_obligation_version on document_obligation(document_version_id);
create index if not exists document_obligation_creator on document_obligation(created_by);
create index if not exists document_obligation_due on document_obligation(due_at,id) where completed_at is null;
create or replace function protect_document_obligation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'document obligation history is immutable'; end if;
 if (to_jsonb(new)-array['prepared_by','reviewer_id','document_version_id','completed_at','reminded_at','escalated_at','version'])
  is distinct from (to_jsonb(old)-array['prepared_by','reviewer_id','document_version_id','completed_at','reminded_at','escalated_at','version']) then
  raise exception 'document obligation terms are immutable';
 end if;
 return new;
end $$;
drop trigger if exists document_obligation_terms on document_obligation;
create trigger document_obligation_terms before update or delete on document_obligation for each row execute function protect_document_obligation();
alter table document_obligation enable row level security;
revoke all on document_obligation from anon,authenticated;
revoke execute on function protect_document_obligation() from public,anon,authenticated;
