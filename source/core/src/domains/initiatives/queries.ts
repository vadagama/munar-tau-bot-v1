import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid,type Row } from "../registry/validation.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { initiativeAudience,initiativeCard,initiativeResource,requireInitiative } from "./access.ts";
import { initiativeSupportState } from "./support-state.ts";
import type { InitiativeRow } from "./types.ts";
import { appealCard,moderationCard,moderationResource,requireModeration,type AppealRow,type ModerationRow } from "./moderation-access.ts";
export interface InitiativePage {offset?:number;limit?:number;state?:string}
function page(options:InitiativePage,states:readonly string[]=[]) {
 const offset=options.offset??0,limit=options.limit??20,state=options.state??null;
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit)||limit<1||limit>50||(state!==null&&!states.includes(state)))invalid("Неверная страница или состояние");
 return {offset,limit,state};
}
function scope(actor:Actor) {
 const managers=actor.assignments.filter(a=>["administrator","deputy"].includes(a.role));
 return {all:actor.assignments.some(a=>a.role==="chairman")||(!!actor.globalStaff&&managers.length>0),scopes:JSON.stringify(managers.map(a=>a.scopeBuildingIds??[]))};
}
const scopeIds="(case when i.publication_state='published' then i.approved_building_ids else i.requested_building_ids end)";
const managed=`($3::boolean or exists(select 1 from jsonb_array_elements($4::text::jsonb) s(value) where ${scopeIds}<@array(select jsonb_array_elements_text(s.value)::uuid)))`;
function flags(actor:Actor,resource:Awaited<ReturnType<typeof initiativeResource>>) {
 return {can_manage:can(actor,"initiative.manage",resource).allow,can_comment:can(actor,"initiative.comment",resource).allow,
  can_support:can(actor,"initiative.support",resource).allow,can_moderate:can(actor,"initiative.moderate",resource).allow};
}
export async function listInitiatives(deps:RegistryDeps,actor:Actor,options:InitiativePage={}) {
 const {offset,limit,state}=page(options,["submitted","published","rejected","collecting","assessing","planned","implementing","completed","deferred"]);
 if(!can(actor,"initiative.use").allow)throw new ApiError("FORBIDDEN");
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  const clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest),s=scope(actor);
  const rows=await exec.query<InitiativeRow>(`select i.* from initiative i where i.is_test=$2
   and (${managed} or (i.publication_state='published' and i.approved_building_ids && $5::uuid[]) or (i.author_person_id=$1 and i.publication_state<>'published'))
   and ($6::text is null or i.publication_state=$6 or i.stage=$6) order by i.created_at desc,i.id limit $7 offset $8`,
   [actor.person.id,actor.person.isTest,s.all,s.scopes,clock.active?clock.building_ids:[],state,limit+1,offset]);
  const items=[];
  for(const row of rows.slice(0,limit)){const resource=await initiativeResource(exec,actor,row,clock);if(can(actor,"initiative.read",resource).allow)items.push({...initiativeCard(row),...flags(actor,resource)});}
  return {items,has_more:rows.length>limit};
 });
}
export async function getInitiative(deps:RegistryDeps,actor:Actor,id:string) {
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  const row=await requireInitiative(exec,actor,id,"initiative.read",true),clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest);
  const resource=await initiativeResource(exec,actor,row,clock),capabilities=flags(actor,resource);
  let at=Number(clock.us);
  if(row.support_closed_at){const [stamp]=await exec.query<{closed_us:string}>("select (extract(epoch from support_closed_at)*1000000)::bigint as closed_us from initiative where id=$1",[id]);if(!stamp)throw new ApiError("NOT_FOUND");at=Number(stamp.closed_us);}
  const support=await initiativeSupportState(exec,row,at,!!row.support_closed_at);
  const [own]=await exec.query<{version:number;supported_at:Date;withdrawn_at:Date|null}>("select version,supported_at,withdrawn_at from initiative_support where initiative_id=$1 and person_id=$2",[id,actor.person.id]);
  const [responsible]=row.responsible_person_id?await exec.query<{full_name:string}>("select full_name from person where id=$1",[row.responsible_person_id]):[];
  return {...initiativeCard(row),...capabilities,support_count:row.final_support_count??support.count,
   own_support:{version:own?.version??0,supported:support.people.includes(actor.person.id)},responsible_name:responsible?.full_name??null,
   ...(capabilities.can_manage?{responsible_person_id:row.responsible_person_id,decision_document_version_id:row.decision_document_version_id}: {})};
 });
}
export async function getInitiativeHistory(deps:RegistryDeps,actor:Actor,id:string,options:InitiativePage={}) {
 const {offset,limit}=page(options);await requireInitiative(deps.db,actor,id);
 const rows=await deps.db.query<Row>("select version,action,publication_state,stage,reason,at from initiative_log where initiative_id=$1 order by version limit $2 offset $3",[id,limit+1,offset]);
 return {items:rows.slice(0,limit),has_more:rows.length>limit};
}
export async function listModerationActions(deps:RegistryDeps,actor:Actor,options:InitiativePage={}) {
 const {offset,limit}=page(options),s=scope(actor);
 if(!can(actor,"initiative.use").allow)throw new ApiError("FORBIDDEN");
 const rows=await deps.db.query<ModerationRow>(`select m.* from moderation_action m join initiative i on i.id=m.initiative_id
  where m.is_test=$2 and (m.target_person_id=$1 or ${managed}) order by m.created_at desc,m.id limit $5 offset $6`,[actor.person.id,actor.person.isTest,s.all,s.scopes,limit+1,offset]);
 return {items:rows.slice(0,limit).map(moderationCard),has_more:rows.length>limit};
}
export async function getModerationAction(deps:RegistryDeps,actor:Actor,id:string) {
 const row=await requireModeration(deps.db,actor,id);
 const decisions=await deps.db.query<Row>("select resolution,reason,before_version,after_version,until_at,created_at from moderation_decision where action_id=$1 order by after_version desc limit 50",[id]);
 return {...moderationCard(row),decisions,can_appeal:can(actor,"moderation.appeal",await moderationResource(deps.db,row)).allow&&!row.revoked_at};
}
export async function listModerationAppeals(deps:RegistryDeps,actor:Actor,options:InitiativePage={}) {
 const {offset,limit,state}=page(options,["open","resolved"]);
 if(!can(actor,"initiative.use").allow)throw new ApiError("FORBIDDEN");
 const chair=actor.assignments.some(a=>a.role==="chairman");
 const rows=await deps.db.query<AppealRow>(`select a.* from moderation_appeal a join moderation_action m on m.id=a.action_id
  where m.is_test=$2 and (a.appellant_person_id=$1 or $3::boolean) and ($4::text is null or a.status=$4)
  order by a.created_at desc,a.id limit $5 offset $6`,[actor.person.id,actor.person.isTest,chair,state,limit+1,offset]);
 return {items:rows.slice(0,limit).map(appealCard),has_more:rows.length>limit};
}
export async function getModerationAppeal(deps:RegistryDeps,actor:Actor,id:string) {
 const [row]=await deps.db.query<AppealRow>("select * from moderation_appeal where id=$1",[id]);if(!row)throw new ApiError("NOT_FOUND");
 const action=await requireModeration(deps.db,actor,row.action_id),resource=await moderationResource(deps.db,action);
 const resolve=can(actor,"moderation.resolve",resource).allow;
 if(!resolve&&!can(actor,"moderation.appeal",resource).allow)throw new ApiError("NOT_FOUND");
 const decisions=await deps.db.query<Row>("select resolution,reason,before_version,after_version,until_at,created_at from moderation_decision where appeal_id=$1",[id]);
 return {...appealCard(row),action:moderationCard(action),decisions,can_resolve:resolve&&row.status==="open"};
}
