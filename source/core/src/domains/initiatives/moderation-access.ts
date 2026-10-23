import type { DbExecutor } from "../../db/client.ts";
import type { Actor,ResourceRef } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { initiativeRow } from "./access.ts";
export interface ModerationRow {
 id:string;initiative_id:string;kind:"hide_comment"|"restrict_author";target_person_id:string;target_comment_id:string|null;
 reason:string;original_until_at:Date|null;until_at:Date|null;revoked_at:Date|null;created_by:string;created_at:Date;is_test:boolean;version:number;
}
export interface AppealRow {id:string;action_id:string;appellant_person_id:string;reason:string;status:"open"|"resolved";version:number;created_at:Date;resolved_at:Date|null}
export async function moderationRow(exec:DbExecutor,id:string,lock=false) {
 const [row]=await exec.query<ModerationRow>(`select * from moderation_action where id=$1${lock?" for update":""}`,[id]);
 if(!row)throw new ApiError("NOT_FOUND");return row;
}
export async function moderationResource(exec:DbExecutor,row:ModerationRow):Promise<ResourceRef> {
 const item=await initiativeRow(exec,row.initiative_id);
 return {moderationAccess:{targetPersonId:row.target_person_id,isTest:row.is_test,buildingIds:item.publication_state==="published"?item.approved_building_ids:item.requested_building_ids}};
}
export async function requireModeration(exec:DbExecutor,actor:Actor,id:string,action:"moderation.read"|"moderation.appeal"|"moderation.resolve"="moderation.read",lock=false) {
 const row=await moderationRow(exec,id,lock);
 if(!can(actor,action,await moderationResource(exec,row)).allow)throw new ApiError("NOT_FOUND");return row;
}
export function moderationCard(row:ModerationRow) {
 return {id:row.id,initiative_id:row.initiative_id,kind:row.kind,comment_id:row.target_comment_id,reason:row.reason,
  original_until_at:row.original_until_at,until_at:row.until_at,revoked_at:row.revoked_at,created_at:row.created_at,version:row.version};
}
export function appealCard(row:AppealRow) {return {id:row.id,action_id:row.action_id,reason:row.reason,status:row.status,version:row.version,created_at:row.created_at,resolved_at:row.resolved_at};}
