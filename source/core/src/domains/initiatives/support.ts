import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { recordAudit,type RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { loadAudienceIntervals,audienceContinuous } from "../registry/audience-history.ts";
import { idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { type Row } from "../registry/validation.ts";
import { initiativeFields } from "./input.ts";
import { initiativeAudience,requireInitiative } from "./access.ts";
interface OwnSupport {version:number;supported_at:Date;supported_us:string;withdrawn_at:Date|null;withdrawn_us?:string}
async function log(exec:DbExecutor,id:string,personId:string,version:number,action:string,at:number) {
  await exec.query(`insert into initiative_support_log(initiative_id,person_id,support_version,action,at)
    values($1,$2,$3,$4,poll_instant($5::bigint)) on conflict do nothing`,[id,personId,version,action,at]);
}
export async function setInitiativeSupport(deps:RegistryDeps,actor:Actor,id:string,active:boolean,input:Row,key:unknown) {
  initiativeFields(input,["expected_version"]);
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`initiative.support:${id}`,key,{active,...input},async()=>{
      const row=await requireInitiative(exec,actor,id,"initiative.support",true),clock=await initiativeAudience(exec,actor.person.id,actor.person.isTest);
      const [old]=await exec.query<OwnSupport>(`select version,supported_at,withdrawn_at,
        (extract(epoch from supported_at)*1000000)::bigint as supported_us
        from initiative_support where initiative_id=$1 and person_id=$2 for update`,[id,actor.person.id]);
      checkVersion(old?.version??0,input.expected_version);
      const intervals=await loadAudienceIntervals(exec,{personId:actor.person.id,isTest:actor.person.isTest,buildingIds:row.approved_building_ids});
      const included=!!old && !old.withdrawn_at && audienceContinuous(intervals,Number(old.supported_us),Number(clock.us));
      if((active && included) || (!active && (!old || old.withdrawn_at)))return {supported:active,version:old?.version??0};
      if(old && !old.withdrawn_at && !included) {
        const start=Number(old.supported_us),interval=intervals.find(i=>i.from<=start && start<i.until);
        await log(exec,id,actor.person.id,old.version,"excluded",Math.min(interval?.until??start,Number(clock.us)));
      }
      let updated:OwnSupport|undefined;
      try {
        [updated]=active?await exec.query<OwnSupport>(`insert into initiative_support(initiative_id,person_id,version,supported_at)
          values($1,$2,1,clock_timestamp()) on conflict(initiative_id,person_id) do update
          set version=initiative_support.version+1,supported_at=clock_timestamp(),withdrawn_at=null,excluded_at=null
          returning version,supported_at,withdrawn_at,(extract(epoch from supported_at)*1000000)::bigint as supported_us`,[id,actor.person.id]):
          await exec.query<OwnSupport>(`update initiative_support set withdrawn_at=clock_timestamp(),version=version+1
            where initiative_id=$1 and person_id=$2 returning version,supported_at,withdrawn_at,
            (extract(epoch from withdrawn_at)*1000000)::bigint as withdrawn_us`,[id,actor.person.id]);
      } catch(error) {
        if(error instanceof Error && ["Initiative is no longer collecting support","Supporter is not eligible"].includes(error.message))throw new ApiError("NOT_FOUND");
        throw error;
      }
      if(!updated)throw new Error("Поддержка не сохранена");
      await log(exec,id,actor.person.id,updated.version,active?"support":"withdraw",Number(active?updated.supported_us:updated.withdrawn_us));
      await recordAudit(deps,exec,actor,active?"initiative.support":"initiative.withdraw","initiative",id,row.approved_building_ids,
        old?{version:old.version}:null,{version:updated.version},active?"Явная поддержка инициативы":"Явный отзыв поддержки инициативы");
      return {supported:active,version:updated.version};
    },()=>requireInitiative(exec,actor,id,"initiative.read"));
  });
}
