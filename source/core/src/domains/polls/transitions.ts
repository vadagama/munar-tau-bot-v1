import type { RegistryDeps } from "../registry/service.ts";
import { recordAudit } from "../registry/service.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { jsonValue,type Row } from "../registry/validation.ts";
import { content,idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { aggregatePoll } from "./aggregate.ts";
import { pollCard,pollResource,pollRow,requirePoll,serverClock } from "./access.ts";
import { persistExclusions } from "./jobs.ts";
import type { PollSummary } from "./results.ts";
import { enqueueNoticeBatch } from "../notifications/service.ts";
import { templateNotice } from "../../templates/notice.ts";

export async function cancelPoll(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown){
  const reason=content(input.reason,"причину отмены");
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`poll.cancel:${id}`,key,input,async()=>{
      const row=await requirePoll(exec,actor,id,"poll.manage",true);
      checkVersion(row.version,input.expected_version);
      const clock=await serverClock(exec);
      if(row.state!=="open" || clock.us>=Number(row.closes_us))throw new ApiError("INVALID_TRANSITION");
      const aggregate=await aggregatePoll(exec,row,clock.us);
      await persistExclusions(exec,id,aggregate.excluded);
      let updated:typeof row|undefined;
      try{
        [updated]=await exec.query<typeof row>("update poll set state='canceled',canceled_at=clock_timestamp(),cancel_reason=$2,version=version+1 where id=$1 returning *",[id,reason]);
      }catch(error){
        if(error instanceof Error && error.message==="Elapsed poll cannot be canceled")throw new ApiError("INVALID_TRANSITION");
        throw error;
      }
      if(!updated)throw new Error("Опрос не отменён");
      updated.options=row.options;
      const people=await exec.query<{person_id:string}>("select person_id from poll_answer where poll_id=$1 order by person_id",[id]);
      await enqueueNoticeBatch(exec,people.map(({person_id:personId})=>({personId,key:`poll.canceled:${id}:${personId}`,
        text:templateNotice("notices.polls.canceled",{question:row.question,reason}),pollId:id,pollEvent:"canceled",type:"personal",audience:"personal",bot:"resident",isTest:row.is_test})));
      await recordAudit(deps,exec,actor,"poll.cancel","poll",id,row.building_ids,{state:row.state,version:row.version},{state:"canceled",version:updated.version},reason);
      return pollCard(updated);
    },response=>requirePoll(exec,actor,response.id,"poll.manage"));
  });
}
export async function getPollResults(deps:RegistryDeps,actor:Actor,id:string):Promise<PollSummary & {as_of:Date|string;final:boolean}> {
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    const row=await pollRow(exec,id);
    // Отказ до чтения распределения и проверки прежних индивидуальных вариантов.
    if(row.state==="canceled" || row.state==="draft")throw new ApiError("NOT_FOUND");
    const clock=await serverClock(exec);
    if(!can(actor,"poll.results",await pollResource(exec,actor,row,clock.us)).allow)throw new ApiError("NOT_FOUND");
    if(row.state==="closed"){
      const [result]=await exec.query<PollSummary & {as_of:Date|string}>("select participants_count,distribution,as_of from poll_result where poll_id=$1",[id]);
      if(!result)throw new Error("Итоговый снимок опроса отсутствует");
      return {participants_count:result.participants_count,distribution:jsonValue<PollSummary["distribution"]>(result.distribution),as_of:result.as_of,final:true};
    }
    const result=await aggregatePoll(exec,row,Math.min(clock.us,Number(row.closes_us)));
    return {...result.summary,as_of:clock.us>=Number(row.closes_us)?row.closes_at:clock.at,final:false};
  });
}
