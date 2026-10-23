-- IDEA-01/FIL-01: приватные фото, состав замораживается при публикации.
select pg_advisory_xact_lock(814733,8);
alter table public.attachment add column if not exists discarded_at timestamptz;
alter table public.attachment drop constraint if exists attachment_owner_type_check;
alter table public.attachment add constraint attachment_owner_type_check check(owner_type in ('message','request','task','document','initiative'));
alter table public.attachment drop constraint if exists attachment_task_owner_check;
alter table public.attachment add constraint attachment_task_owner_check check(
 (owner_type='task' and task_id is not null and owner_id=task_id and request_id is null and bucket='internal') or
 (owner_type in ('document','initiative') and task_id is null and task_report_id is null and request_id is null) or
 (owner_type in ('request','message') and task_id is null and task_report_id is null and request_id is not null));
alter table public.attachment drop constraint if exists attachment_discarded_initiative;
alter table public.attachment add constraint attachment_discarded_initiative check(discarded_at is null or owner_type='initiative');
create or replace function public.initiative_photo_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare a public.attachment; i public.initiative;
begin
 a:=case when TG_OP='DELETE' then old else new end;
 if TG_OP<>'INSERT' and old.owner_type='initiative' and new.owner_type is distinct from old.owner_type then
   raise exception 'Initiative photo cannot be moved' using errcode='23514'; end if;
 if a.owner_type<>'initiative' then return a; end if;
 if TG_OP='DELETE' then raise exception 'Discard initiative photo explicitly' using errcode='23514'; end if;
 select * into i from public.initiative where id=a.owner_id for update;
 if not found or i.publication_state<>'submitted' or a.uploaded_by<>i.author_person_id or a.bucket<>'resident' or
    a.mime not in ('image/jpeg','image/png','image/webp','image/heic','image/heif') or a.size_bytes>20971520 or
    not exists(select 1 from public.person p join public.profile f on f.person_id=p.id where p.id=a.uploaded_by
      and p.status='active' and p.is_test=i.is_test and f.archived_at is null and f.is_test=i.is_test) then
   raise exception 'Initiative photo is unavailable' using errcode='23514'; end if;
 if TG_OP='INSERT' then
   if a.status<>'incomplete' or a.discarded_at is not null or
    (select count(*) from public.attachment x where x.owner_type='initiative' and x.owner_id=a.owner_id and x.discarded_at is null)>=10 then
     raise exception 'Invalid initiative photo upload' using errcode='23514'; end if;
 else
   if old.discarded_at is not null or
     (to_jsonb(new)-array['status','upload_expires_at','discarded_at']) is distinct from
     (to_jsonb(old)-array['status','upload_expires_at','discarded_at']) or
     (old.status='complete' and (new.status<>old.status or new.upload_expires_at<>old.upload_expires_at)) then
     raise exception 'Initiative photo is immutable' using errcode='23514'; end if;
 end if;
 return new;
end $$;
drop trigger if exists initiative_photo_guard on public.attachment;
create trigger initiative_photo_guard before insert or update or delete on public.attachment for each row execute function public.initiative_photo_guard();
revoke execute on function public.initiative_photo_guard() from public,anon,authenticated;
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
   if old.publication_state='submitted' and new.publication_state='submitted' and
      (to_jsonb(new)-'version')=(to_jsonb(old)-'version') then return new; end if;
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
 if new.publication_state='published' and exists(select 1 from public.attachment a where a.owner_type='initiative'
   and a.owner_id=new.id and a.discarded_at is null and a.status<>'complete') then
   raise exception 'Incomplete initiative photos' using errcode='23514'; end if;
 if new.stage in ('planned','implementing','completed') and new.owner_decision_required and not exists(
   select 1 from public.document_version v join public.document d on d.id=v.document_id
   where v.id=new.decision_document_version_id and v.state='approved' and d.is_test=new.is_test and d.kind='decision_basis'
 ) then raise exception 'Approved owner decision is required' using errcode='23514'; end if;
 return new;
end $$;
