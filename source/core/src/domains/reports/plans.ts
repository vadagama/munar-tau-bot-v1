import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
interface PlanRow {id:string;title:string;kind:string;state:string;is_test:boolean;building_ids:string[];member:boolean;planned_start:string|null;planned_end:string|null}
/** Только публичные планы/результаты. Те же manager/member условия publication.read до LIMIT. */
export async function publishedPlans(deps:RegistryDeps,actor:Actor,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new ApiError("VALIDATION_FAILED");
 if(actor.person.status!=="active")throw new ApiError("FORBIDDEN");
 return deps.db.transaction(async exec=>{await lockAudience(exec);
  const chairman=actor.assignments.some(a=>a.role==="chairman"),areas=actor.assignments.filter(a=>["administrator","deputy"].includes(a.role)).map(a=>a.scopeBuildingIds??[]);
  const rows=await exec.query<PlanRow>(`/* report.plans */ select p.id,p.title,p.kind,p.state,p.is_test,s.building_ids,membership.member,p.planned_start::text,p.planned_end::text
   from publication p cross join lateral(select array_agg(s.building_id order by s.building_id) as building_ids from publication_scope s where s.publication_id=p.id) s
   cross join lateral(select exists(select 1 from connection c join premises pm on pm.id=c.premises_id where c.person_id=$2 and c.status='active' and pm.is_test=$1 and pm.building_id=any(s.building_ids)) as member) membership
   where p.is_test=$1 and p.state='published' and p.kind<>'financial_report' and (p.kind='work_report' or p.planned_start is not null or p.planned_end is not null)
   and cardinality(s.building_ids)>0 and ($3 or membership.member or exists(select 1 from jsonb_array_elements($4::text::jsonb) a(area)
    where not exists(select 1 from unnest(s.building_ids) b(id) where not (a.area ? b.id::text))))
   order by coalesce(p.published_at,p.created_at) desc,p.id limit 11 offset $5`,[actor.person.isTest,actor.person.id,chairman,JSON.stringify(areas),offset]);
  const visible=rows.filter(r=>can(actor,"publication.read",{publicationAccess:{buildingIds:r.building_ids,isTest:r.is_test,published:r.state==="published",member:r.member}}).allow);
  return {items:visible.slice(0,10).map(r=>({id:r.id,title:r.title,kind:r.kind,planned_start:r.planned_start,planned_end:r.planned_end})),has_more:visible.length>10};
 });
}
