import { enqueueInitiativeReview,enqueueInitiativeState } from "./events.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { invalid,type Row } from "../registry/validation.ts";
import { content,idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { requireTaskAssignee } from "../tasks/assignees.ts";
import { initiativeAudience,initiativeCard,initiativeResource,requireInitiative } from "./access.ts";
import { submissionInput,initiativeBuildings,initiativeFields,planInput } from "./input.ts";
import { publicationTransition,stageTransition } from "./fsm.ts";
import { checkedInitiativeDecision } from "./planning.ts";
import { initiativeSupportState,persistInitiativeExclusions } from "./support-state.ts";
import type { InitiativeRow,InitiativeStage } from "./types.ts";
async function history(exec:DbExecutor,actor:Actor,row:InitiativeRow,action:string,reason:string) {
  await exec.query(`insert into initiative_log(initiative_id,version,action,publication_state,stage,reason,by_person_id)
    values($1,$2,$3,$4,$5,$6,$7)`,[row.id,row.version,action,row.publication_state,row.stage,reason,actor.person.id]);
}
export async function submitInitiative(deps:RegistryDeps,actor:Actor,input:Row,key:unknown) {
  const data=submissionInput(input);
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,"initiative.submit",key,input,async()=>{
      const state=await initiativeAudience(exec,actor.person.id,actor.person.isTest);
      const resource={initiativeAccess:{buildingIds:data.building_ids,requestedBuildingIds:data.building_ids,isTest:actor.person.isTest,
        authorId:actor.person.id,publicationState:"submitted" as const,stage:null,member:state.active,
        allRequestedMember:state.active && data.building_ids.every(id=>state.building_ids.includes(id)),restricted:state.restricted}};
      if(!can(actor,"initiative.create",resource).allow)throw new ApiError("FORBIDDEN");
      const [row]=await exec.query<InitiativeRow>(`insert into initiative(author_person_id,title,body,location_text,requested_building_ids,is_test)
        values($1,$2,$3,$4,$5,$6) returning *`,[actor.person.id,data.title,data.body,data.location_text,data.building_ids,actor.person.isTest]);
      if(!row)throw new Error("Инициатива не сохранена");
      await history(exec,actor,row,"submit","Подача инициативы");
      await enqueueInitiativeReview(exec,row);
      await recordAudit(deps,exec,actor,"initiative.submit","initiative",row.id,row.requested_building_ids,null,{version:row.version},"Подача инициативы");
      return initiativeCard(row);
    },response=>requireInitiative(exec,actor,response.id));
  });
}
export async function transitionInitiative(deps:RegistryDeps,actor:Actor,id:string,action:string,input:Row,key:unknown) {
  const reason=content(input.reason,"причину");
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`initiative.transition:${id}`,key,{action,...input},async()=>{
      const row=await requireInitiative(exec,actor,id,"initiative.manage",true);checkVersion(row.version,input.expected_version);
      const clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest),patch:Row={};
      if(action==="publish" || action==="reject") {
        initiativeFields(input,action==="publish"?["expected_version","reason","building_ids","owner_decision_required"]:["expected_version","reason"]);
        patch.publication_state=publicationTransition(row.publication_state,action);patch.review_reason=reason;
        if(action==="publish") {
          const pending=await exec.query("select id from attachment where owner_type='initiative' and owner_id=$1 and discarded_at is null and status<>'complete' limit 1",[id]);
          if(pending.length)throw new ApiError("INVALID_TRANSITION","Дождитесь сохранения фотографий или исключите незавершённые");
          const author=await initiativeAudience(exec,row.author_person_id,row.is_test);
          if(!author.active || !row.requested_building_ids.every(id=>author.building_ids.includes(id)))throw new ApiError("INVALID_TRANSITION");
          const ids=initiativeBuildings(input.building_ids),buildings=await exec.query<{id:string}>("select id from building order by id");
          if(!ids.every(id=>buildings.some(b=>b.id===id)))invalid("Дом инициативы не найден");
          const chairman=actor.assignments.some(a=>a.role==="chairman");
          const expanded=ids.some(id=>!row.requested_building_ids.includes(id)),wholeOsi=buildings.every(b=>ids.includes(b.id));
          if((expanded && (!chairman || !wholeOsi)) || (wholeOsi && !chairman))throw new ApiError("FORBIDDEN");
          const resource=await initiativeResource(exec,actor,{...row,publication_state:"published",approved_building_ids:ids},clock);
          if(!can(actor,"initiative.manage",resource).allow)throw new ApiError("FORBIDDEN");
          if(input.owner_decision_required!==undefined && typeof input.owner_decision_required!=="boolean")invalid("Укажите необходимость решения собственников");
          Object.assign(patch,{approved_building_ids:ids,stage:"collecting",stage_reason:reason,published_at:clock.at_text,
            owner_decision_required:row.owner_decision_required || input.owner_decision_required===true});
        }
      } else {
        if(row.publication_state!=="published" || !row.stage)throw new ApiError("INVALID_TRANSITION");
        patch.stage=stageTransition(row.stage,action as InitiativeStage);patch.stage_reason=reason;
        if(action==="planned") {
          const plan=planInput(row.owner_decision_required,input);
          await requireTaskAssignee(exec,plan.responsible_person_id,row.is_test);
          const snapshot=plan.decision_document_version_id?await checkedInitiativeDecision(exec,actor,plan.decision_document_version_id,row.approved_building_ids):null;
          Object.assign(patch,{plan_basis:plan.basis,responsible_person_id:plan.responsible_person_id,estimated_due_at:plan.estimated_due_at,
            owner_decision_required:plan.owner_decision_required,decision_document_version_id:plan.decision_document_version_id,decision_snapshot:snapshot});
        } else {
          initiativeFields(input,["expected_version","reason"]);
          if(["implementing","completed"].includes(action)) {
            if(row.responsible_person_id)await requireTaskAssignee(exec,row.responsible_person_id,row.is_test);
            if(row.owner_decision_required) {
              if(!row.decision_document_version_id)throw new ApiError("INVALID_TRANSITION");
              await checkedInitiativeDecision(exec,actor,row.decision_document_version_id,row.approved_building_ids);
            }
          }
          if(action==="completed" || action==="rejected") {
            const support=await initiativeSupportState(exec,row,Number(clock.us),true);
            await persistInitiativeExclusions(exec,id,support.excluded);
            Object.assign(patch,{support_closed_at:clock.at_text,final_support_count:support.count});
            if(action==="completed")patch.completed_at=clock.at_text;
          }
        }
      }
      const [updated]=await exec.query<InitiativeRow>(`update initiative set
        publication_state=p.publication_state,stage=p.stage,review_reason=p.review_reason,stage_reason=p.stage_reason,
        approved_building_ids=p.approved_building_ids,published_at=p.published_at,plan_basis=p.plan_basis,
        responsible_person_id=p.responsible_person_id,estimated_due_at=p.estimated_due_at,
        owner_decision_required=p.owner_decision_required,decision_document_version_id=p.decision_document_version_id,
        decision_snapshot=p.decision_snapshot,completed_at=p.completed_at,support_closed_at=p.support_closed_at,
        final_support_count=p.final_support_count,version=initiative.version+1
        from initiative original cross join lateral
        jsonb_populate_record(null::initiative,to_jsonb(original)||$2::text::jsonb) p
        where initiative.id=$1 and original.id=initiative.id returning initiative.*`,[id,JSON.stringify(patch)]);
      if(!updated)throw new Error("Инициатива не изменена");
      await history(exec,actor,updated,action,reason);
      await enqueueInitiativeState(exec,updated);
      await recordAudit(deps,exec,actor,`initiative.${action}`,"initiative",id,updated.approved_building_ids.length?updated.approved_building_ids:updated.requested_building_ids,
        {version:row.version,publication_state:row.publication_state,stage:row.stage},{version:updated.version,publication_state:updated.publication_state,stage:updated.stage},reason);
      return initiativeCard(updated);
    },response=>requireInitiative(exec,actor,response.id,"initiative.manage"));
  });
}
