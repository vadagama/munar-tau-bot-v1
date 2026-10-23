-- IDEA-02: одна текущая поддержка, проверяемая в момент записи.
select pg_advisory_xact_lock(814733,8);
create or replace function public.initiative_support_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare item public.initiative; stamp timestamptz:=clock_timestamp(); local_day date:=(stamp at time zone 'Asia/Almaty')::date;
begin
 select * into item from public.initiative where id=new.initiative_id;
 if not found or item.publication_state<>'published' or item.stage in ('completed','rejected') then
   raise exception 'Initiative is no longer collecting support' using errcode='23514';
 end if;
 if not exists(select 1 from public.connection c join public.premises m on m.id=c.premises_id
   join public.person p on p.id=c.person_id where p.id=new.person_id and p.status='active' and p.is_test=item.is_test
   and m.status='active' and m.is_test=item.is_test and m.building_id=any(item.approved_building_ids) and c.status='active'
   and (c.start_date is null or c.start_date<=local_day) and (c.end_date is null or c.end_date>=local_day)
   and exists(select 1 from public.profile f where f.person_id=p.id and f.archived_at is null and f.is_test=item.is_test)
 ) then raise exception 'Supporter is not eligible' using errcode='23514'; end if;
 if TG_OP='INSERT' then
   if new.version<>1 or new.withdrawn_at is not null then raise exception 'Invalid initial support' using errcode='23514'; end if;
 else
   if (new.initiative_id,new.person_id) is distinct from (old.initiative_id,old.person_id) or new.version<>old.version+1 then
     raise exception 'Invalid support version or identity' using errcode='23514';
   end if;
 end if;
 if new.withdrawn_at is null then new.supported_at:=stamp;new.excluded_at:=null;
 else new.withdrawn_at:=stamp;new.supported_at:=old.supported_at;end if;
 return new;
end $$;
drop trigger if exists initiative_support_guard on public.initiative_support;
create trigger initiative_support_guard before insert or update of initiative_id,person_id,version,supported_at,withdrawn_at on public.initiative_support
 for each row execute function public.initiative_support_guard();
drop trigger if exists initiative_support_gate on public.initiative_support;
create trigger initiative_support_gate before insert or update or delete on public.initiative_support
 for each statement execute function public.audience_statement_gate();
drop trigger if exists initiative_support_no_delete on public.initiative_support;
create trigger initiative_support_no_delete before delete on public.initiative_support
 for each statement execute function public.audience_history_immutable();
drop trigger if exists moderation_action_gate on public.moderation_action;
create trigger moderation_action_gate before insert or update or delete on public.moderation_action
 for each statement execute function public.audience_statement_gate();
revoke execute on function public.initiative_support_guard() from public,anon,authenticated;

-- Та же защита идентичности применяется к ранее созданным личным ответам POL.
drop trigger if exists poll_answer_guard on public.poll_answer;
create trigger poll_answer_guard before insert or update of poll_id,person_id,version,option_key,answered_at
 on public.poll_answer for each row execute function public.poll_answer_guard();
