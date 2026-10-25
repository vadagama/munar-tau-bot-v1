import type { DbExecutor } from "../../db/client.ts";
import type { Actor,ResourceRef } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { InitiativeRow } from "./types.ts";
export interface AudienceState {at:Date;at_text:string;us:string;building_ids:string[];restricted:boolean;active:boolean}
/** Одна серверная отметка для окон связей и ограничения; фон не нужен для истечения. */
export async function initiativeAudience(exec:DbExecutor,personId:string,isTest:boolean):Promise<AudienceState> {
  const [state]=await exec.query<AudienceState>(`with initiative_clock as materialized(select clock_timestamp() as at)
    select clock.at,clock.at::text as at_text,(extract(epoch from clock.at)*1000000)::bigint as us,
    array(select distinct m.building_id from connection c join premises m on m.id=c.premises_id
      join person p on p.id=c.person_id where p.id=$1 and p.status='active' and p.is_test=$2
      and m.status='active' and m.is_test=$2 and c.status='active'
      and (c.start_date is null or c.start_date<=(clock.at at time zone 'Asia/Almaty')::date)
      and (c.end_date is null or c.end_date>=(clock.at at time zone 'Asia/Almaty')::date)
      and exists(select 1 from profile f where f.person_id=p.id and f.archived_at is null and f.is_test=$2)) as building_ids,
    exists(select 1 from moderation_action a where a.target_person_id=$1 and a.is_test=$2
      and a.kind='restrict_author' and a.revoked_at is null and a.until_at>clock.at) as restricted,
    exists(select 1 from person p join profile f on f.person_id=p.id where p.id=$1 and p.status='active'
      and p.is_test=$2 and f.archived_at is null and f.is_test=$2) as active
    from initiative_clock clock`,[personId,isTest]);
  if(!state)throw new Error("Состояние аудитории недоступно");
  return state;
}
export async function initiativeRow(exec:DbExecutor,id:string,lock=false):Promise<InitiativeRow> {
  const [row]=await exec.query<InitiativeRow>(`select * from initiative where id=$1${lock?" for update":""}`,[id]);
  if(!row)throw new ApiError("NOT_FOUND");return row;
}
export async function initiativeResource(exec:DbExecutor,actor:Actor,row:InitiativeRow,state?:AudienceState):Promise<ResourceRef> {
  const current=state??await initiativeAudience(exec,actor.person.id,actor.person.isTest);
  const ids=row.publication_state==="published"?row.approved_building_ids:row.requested_building_ids;
  return {initiativeAccess:{buildingIds:ids,requestedBuildingIds:row.requested_building_ids,isTest:row.is_test,
    authorId:row.author_person_id,publicationState:row.publication_state,stage:row.stage,
    member:current.active && ids.some(id=>current.building_ids.includes(id)),
    allRequestedMember:current.active && row.requested_building_ids.every(id=>current.building_ids.includes(id)),restricted:current.restricted}};
}
export type InitiativeAction="initiative.attach"|"initiative.read"|"initiative.manage"|"initiative.support"|"initiative.comment"|"initiative.moderate";
export async function requireInitiative(exec:DbExecutor,actor:Actor,id:string,action:InitiativeAction="initiative.read",lock=false) {
  const row=await initiativeRow(exec,id,lock);
  if(!can(actor,action,await initiativeResource(exec,actor,row)).allow)throw new ApiError("NOT_FOUND");
  return row;
}
/** Явный публичный DTO: внутренний снимок документа и личности поддержавших не выдаются. */
export function initiativeCard(row:InitiativeRow) {
  return {id:row.id,title:row.title,body:row.body,location_text:row.location_text,
    requested_building_ids:row.requested_building_ids,approved_building_ids:row.approved_building_ids,
    publication_state:row.publication_state,stage:row.stage,version:row.version,created_at:row.created_at,published_at:row.published_at,
    review_reason:row.review_reason,stage_reason:row.stage_reason,plan_basis:row.plan_basis,
    estimated_due_at:row.estimated_due_at,owner_decision_required:row.owner_decision_required,
    completed_at:row.completed_at,final_support_count:row.final_support_count};
}
