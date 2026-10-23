import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { DbExecutor } from "../../db/client.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { invalid,type Row } from "../registry/validation.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { initiativeFields,initiativeText } from "./input.ts";
import { initiativeRow,initiativeResource,requireInitiative } from "./access.ts";
export interface CommentRow {id:string;initiative_id:string;author_person_id:string;author_name:string;body:string;created_at:Date;hidden:boolean;is_test:boolean}
const commentSelect=`select c.*,p.full_name as author_name,exists(select 1 from moderation_action m where m.target_comment_id=c.id and m.kind='hide_comment' and m.revoked_at is null) as hidden
 from initiative_comment c join person p on p.id=c.author_person_id`;
export function commentCard(row:CommentRow) {return {id:row.id,initiative_id:row.initiative_id,author_name:row.author_name,body:row.body,created_at:row.created_at,hidden:row.hidden};}
export async function commentRow(exec:DbExecutor,id:string) {
 const [row]=await exec.query<CommentRow>(`${commentSelect} where c.id=$1`,[id]);if(!row)throw new ApiError("NOT_FOUND");return row;
}
export async function readInitiativeComment(deps:RegistryDeps,actor:Actor,id:string) {
 const row=await commentRow(deps.db,id),item=await initiativeRow(deps.db,row.initiative_id);
 const resource=await initiativeResource(deps.db,actor,item);
 const privateAccess=can(actor,"moderation.read",{moderationAccess:{targetPersonId:row.author_person_id,isTest:row.is_test,buildingIds:resource.initiativeAccess!.buildingIds}}).allow;
 if(!(privateAccess||(can(actor,"initiative.read",resource).allow&&!row.hidden)))throw new ApiError("NOT_FOUND");
 return commentCard(row);
}
export async function listInitiativeComments(deps:RegistryDeps,actor:Actor,id:string,offset=0) {
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000)invalid("Некорректная страница");
 const item=await requireInitiative(deps.db,actor,id),manager=can(actor,"initiative.moderate",await initiativeResource(deps.db,actor,item)).allow;
 const rows=await deps.db.query<CommentRow>(`${commentSelect} where c.initiative_id=$1
  and (not exists(select 1 from moderation_action m where m.target_comment_id=c.id and m.kind='hide_comment' and m.revoked_at is null)
    or c.author_person_id=$2 or $3::boolean) order by c.created_at,c.id limit 21 offset $4`,[id,actor.person.id,manager,offset]);
 return {items:rows.slice(0,20).map(commentCard),has_more:rows.length>20};
}
export async function addInitiativeComment(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown) {
 initiativeFields(input,["body","expected_version"]);const body=initiativeText(input.body,"комментарий",10000);
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  return idempotent(exec,actor,`initiative.comment:${id}`,key,input,async()=>{
   const item=await requireInitiative(exec,actor,id,"initiative.comment",true);checkVersion(item.version,input.expected_version);
   const [row]=await exec.query<{id:string}>(`insert into initiative_comment(initiative_id,author_person_id,body,is_test)
    values($1,$2,$3,$4) returning id`,[id,actor.person.id,body,item.is_test]);if(!row)throw new Error("Комментарий не сохранён");
   await recordAudit(deps,exec,actor,"initiative.comment","initiative",id,item.approved_building_ids,null,{comment_id:row.id},"Комментарий к инициативе");
   return commentCard(await commentRow(exec,row.id));
  },async()=>{await requireInitiative(exec,actor,id);});
 });
}
