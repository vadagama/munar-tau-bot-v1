-- IDEA-01–03: публикация и этапы независимы, аудитория хранится снимком.
select pg_advisory_xact_lock(814733,8);
create table if not exists public.initiative (
 id uuid primary key default gen_random_uuid(),
 author_person_id uuid not null references public.person(id),
 title text not null check(length(btrim(title)) between 1 and 300),
 body text not null check(length(btrim(body)) between 1 and 10000),
 location_text text not null check(length(btrim(location_text)) between 1 and 500),
 requested_building_ids uuid[] not null check(cardinality(requested_building_ids) between 1 and 100),
 approved_building_ids uuid[] not null default '{}',
 publication_state text not null default 'submitted' check(publication_state in ('submitted','published','rejected')),
 stage text check(stage in ('collecting','assessing','planned','implementing','completed','rejected','deferred')),
 is_test boolean not null,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 published_at timestamptz,
 completed_at timestamptz,
 support_closed_at timestamptz,
 stage_reason text,
 review_reason text,
 plan_basis text,
 responsible_person_id uuid references public.person(id),
 estimated_due_at timestamptz,
 owner_decision_required boolean not null default false,
 decision_document_version_id uuid references public.document_version(id),
 decision_snapshot jsonb,
 final_support_count integer check(final_support_count>=0),
 check((publication_state='published')=(stage is not null)),
 check((publication_state='published')=(published_at is not null)),
 check(publication_state<>'published' or cardinality(approved_building_ids) between 1 and 100),
 check(publication_state<>'rejected' or coalesce(length(btrim(review_reason)),0)>0),
 check((stage is not distinct from 'completed')=(completed_at is not null)),
 check(coalesce(stage in ('completed','rejected'),false)=(support_closed_at is not null)),
 check(coalesce(stage in ('completed','rejected'),false)=(final_support_count is not null)),
 check(stage is null or coalesce(length(btrim(stage_reason)),0)>0),
 check(stage not in ('planned','implementing','completed') or
   (coalesce(length(btrim(plan_basis)),0)>0 and responsible_person_id is not null and estimated_due_at is not null)),
 check(stage not in ('planned','implementing','completed') or not owner_decision_required or decision_document_version_id is not null),
 check((decision_document_version_id is null)=(decision_snapshot is null)),
 constraint initiative_decision_snapshot_id_matches check(decision_snapshot is null or (jsonb_typeof(decision_snapshot)='object' and decision_snapshot ? 'id' and ((decision_snapshot->>'id') is not distinct from decision_document_version_id::text)))
);
create index if not exists initiative_mode_created on public.initiative(is_test,created_at desc,id);
create index if not exists initiative_author on public.initiative(author_person_id,created_at desc,id);
create table if not exists public.initiative_log (
 id bigserial primary key,
 initiative_id uuid not null references public.initiative(id),
 version integer not null,
 action text not null,
 publication_state text not null,
 stage text,
 reason text not null,
 by_person_id uuid not null references public.person(id),
 at timestamptz not null default clock_timestamp(),
 unique(initiative_id,version)
);
create table if not exists public.initiative_support (
 initiative_id uuid not null references public.initiative(id),
 person_id uuid not null references public.person(id),
 version integer not null default 1 check(version>0),
 supported_at timestamptz not null default clock_timestamp(),
 withdrawn_at timestamptz,
 excluded_at timestamptz,
 primary key(initiative_id,person_id)
);
create table if not exists public.initiative_support_log (
 id bigserial primary key,
 initiative_id uuid not null references public.initiative(id),
 person_id uuid not null references public.person(id),
 support_version integer not null,
 action text not null check(action in ('support','withdraw','excluded')),
 at timestamptz not null default clock_timestamp(),
 unique(initiative_id,person_id,support_version,action)
);
-- MOD-02: исходное действие и текущая граница ограничения хранятся раздельно.
-- Комментарии/оспаривания и их FK подключаются I03; прямого доступа нет.
create table if not exists public.moderation_action (
 id uuid primary key default gen_random_uuid(),
 initiative_id uuid not null references public.initiative(id),
 kind text not null check(kind in ('hide_comment','restrict_author')),
 target_person_id uuid not null references public.person(id),
 target_comment_id uuid,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 original_until_at timestamptz,
 until_at timestamptz,
 revoked_at timestamptz,
 created_by uuid not null references public.person(id),
 created_at timestamptz not null default clock_timestamp(),
 is_test boolean not null,
 version integer not null default 1 check(version>0),
 check((kind='hide_comment')=(target_comment_id is not null)),
 check(kind<>'restrict_author' or (original_until_at is not null and original_until_at>created_at and until_at is not null))
);
create index if not exists moderation_person_active on public.moderation_action(target_person_id,until_at) where kind='restrict_author' and revoked_at is null;
create or replace function public.initiative_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if array_position(new.requested_building_ids,null) is not null or
    cardinality(new.requested_building_ids)<>(select count(distinct id) from unnest(new.requested_building_ids) id) or
    array_position(new.approved_building_ids,null) is not null or
    cardinality(new.approved_building_ids)<>(select count(distinct id) from unnest(new.approved_building_ids) id) then
   raise exception 'Invalid initiative scope' using errcode='23514';
 end if;
 if TG_OP='INSERT' then
   if exists(select 1 from public.moderation_action m where m.target_person_id=new.author_person_id
     and m.kind='restrict_author' and m.is_test=new.is_test and m.revoked_at is null and m.until_at>clock_timestamp()) then
     raise exception 'Initiative author is restricted' using errcode='23514';
   end if;
   if new.publication_state<>'submitted' or new.stage is not null or cardinality(new.approved_building_ids)<>0 then
     raise exception 'Initiative starts as submitted' using errcode='23514';
   end if;
 else
   if new.version<>old.version+1 then raise exception 'Initiative version must advance' using errcode='23514'; end if;
   if (new.author_person_id,new.title,new.body,new.location_text,new.requested_building_ids,new.is_test,new.created_at) is distinct from
      (old.author_person_id,old.title,old.body,old.location_text,old.requested_building_ids,old.is_test,old.created_at) then
     raise exception 'Original initiative is immutable' using errcode='23514';
   end if;
   if old.publication_state='rejected' or old.stage in ('completed','rejected') then
     raise exception 'Final initiative is immutable' using errcode='23514';
   end if;
   if old.publication_state='submitted' then
     if new.publication_state not in ('published','rejected') or (new.publication_state='published' and new.stage<>'collecting') then
       raise exception 'Invalid publication decision' using errcode='23514';
     end if;
   else
     if new.publication_state<>old.publication_state or (new.approved_building_ids,new.published_at) is distinct from (old.approved_building_ids,old.published_at) then
       raise exception 'Published initiative scope is immutable' using errcode='23514';
     end if;
     if not ((old.stage='collecting' and new.stage in ('assessing','rejected','deferred')) or
       (old.stage='assessing' and new.stage in ('planned','rejected','deferred')) or
       (old.stage='planned' and new.stage in ('implementing','rejected','deferred')) or
       (old.stage='implementing' and new.stage in ('completed','rejected','deferred')) or
       (old.stage='deferred' and new.stage in ('assessing','rejected'))) then
       raise exception 'Invalid initiative stage transition' using errcode='23514';
     end if;
   end if;
   if old.owner_decision_required and not new.owner_decision_required then
     raise exception 'Owner decision requirement cannot be removed' using errcode='23514';
   end if;
   if new.stage is distinct from 'planned' and
     (new.plan_basis,new.responsible_person_id,new.estimated_due_at,new.decision_document_version_id,new.decision_snapshot) is distinct from
     (old.plan_basis,old.responsible_person_id,old.estimated_due_at,old.decision_document_version_id,old.decision_snapshot) then
     raise exception 'Planning data changes only on planning' using errcode='23514';
   end if;
 end if;
 if new.stage in ('planned','implementing','completed') and new.owner_decision_required and not exists(
   select 1 from public.document_version v join public.document d on d.id=v.document_id
   where v.id=new.decision_document_version_id and v.state='approved' and d.is_test=new.is_test and d.kind='decision_basis'
 ) then raise exception 'Approved owner decision is required' using errcode='23514'; end if;
 return new;
end $$;
drop trigger if exists initiative_guard on public.initiative;
create trigger initiative_guard before insert or update on public.initiative for each row execute function public.initiative_guard();
drop trigger if exists initiative_gate on public.initiative;
create trigger initiative_gate before insert or update or delete on public.initiative for each statement execute function public.audience_statement_gate();
drop trigger if exists initiative_no_delete on public.initiative;
create trigger initiative_no_delete before delete on public.initiative for each statement execute function public.audience_history_immutable();
do $$ declare t text; begin
 foreach t in array array['initiative_log','initiative_support_log'] loop
   execute format('drop trigger if exists %I on public.%I',t||'_immutable',t);
   execute format('create trigger %I before update or delete on public.%I for each statement execute function public.audience_history_immutable()',t||'_immutable',t);
 end loop;
 foreach t in array array['initiative','initiative_log','initiative_support','initiative_support_log','moderation_action'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke execute on function public.initiative_guard() from public,anon,authenticated;
revoke all on sequence public.initiative_log_id_seq,public.initiative_support_log_id_seq from public,anon,authenticated;
