import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { DbExecutor } from "../../db/client.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { audienceContinuous, audienceContinuousBefore, loadAudienceIntervals } from "../registry/audience-history.ts";
import { pollInput, answerInput } from "./input.ts";
import { pollCard, pollResource, pollRow, requirePoll, serverClock, type PollRow } from "./access.ts";

export async function savePoll(deps:RegistryDeps,actor:Actor,id:string|null,input:Row,key:unknown) {
  const reason=content(input.reason,"причину");
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`poll.save:${id??"new"}`,key,input,async()=>{
      const old=id?await requirePoll(exec,actor,id,"poll.manage",true):null;
      if(old){checkVersion(old.version,input.expected_version);if(old.state!=="draft")throw new ApiError("INVALID_TRANSITION");}
      const data=pollInput({...old && {question:old.question,options:old.options,building_ids:old.building_ids,closes_at:new Date(old.closes_at).toISOString()},...input});
      if(!can(actor,"poll.manage",{pollAccess:{buildingIds:data.building_ids,isTest:actor.person.isTest,state:"draft",member:false,participant:false,finalParticipant:false,answerOpen:false}}).allow)throw new ApiError("FORBIDDEN");
      if((await exec.query("select id from building where id=any($1::uuid[])",[data.building_ids])).length!==data.building_ids.length)invalid("Дом опроса не найден");
      const values=[data.question,JSON.stringify(data.options),data.building_ids,data.closes_at];
      const [row]=old?await exec.query<PollRow>("update poll set question=$1,options=$2::text::jsonb,building_ids=$3,closes_at=$4,version=version+1 where id=$5 returning *",[...values,id]):
        await exec.query<PollRow>("insert into poll(question,options,building_ids,closes_at,is_test,created_by) values($1,$2::text::jsonb,$3,$4,$5,$6) returning *",[...values,actor.person.isTest,actor.person.id]);
      if(!row)throw new Error("Опрос не сохранён");
      row.options=data.options;
      await recordAudit(deps,exec,actor,old?"poll.update":"poll.create","poll",row.id,data.building_ids,old?{version:old.version}:null,{version:row.version,state:row.state},reason);
      return pollCard(row);
    },response=>requirePoll(exec,actor,response.id,"poll.manage"));
  });
}
export async function openPoll(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown) {
  const reason=content(input.reason,"причину открытия");
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`poll.open:${id}`,key,input,async()=>{
      const row=await requirePoll(exec,actor,id,"poll.manage",true);
      checkVersion(row.version,input.expected_version);
      if(row.state!=="draft")throw new ApiError("INVALID_TRANSITION");
      const clock=await serverClock(exec);
      if(clock.us>=Number(row.closes_us))invalid("Окончание должно быть в будущем");
      const [meta]=await exec.query<{starts_us:string}>("select (extract(epoch from starts_at)*1000000)::bigint as starts_us from audience_history_meta where singleton");
      if(!meta || clock.us<Number(meta.starts_us))throw new ApiError("INVALID_TRANSITION");
      if((await exec.query("select id from building where id=any($1::uuid[])",[row.building_ids])).length!==row.building_ids.length)invalid("Область опроса изменилась; исправьте черновик");
      const [updated]=await exec.query<PollRow>("update poll set state='open',opened_at=clock_timestamp(),version=version+1 where id=$1 returning *",[id]);
      if(!updated)throw new Error("Опрос не открыт");
      updated.options=row.options;
      await recordAudit(deps,exec,actor,"poll.open","poll",id,row.building_ids,{version:row.version},{version:updated.version,state:"open"},reason);
      return pollCard(updated);
    },response=>requirePoll(exec,actor,response.id,"poll.manage"));
  });
}
export async function ownAnswer(exec:DbExecutor,actor:Actor,row:PollRow,at:number) {
  const [answer]=await exec.query<{option_key:string;version:number;answered_at:Date;answered_us:string}>(`select option_key,version,answered_at,(extract(epoch from answered_at)*1000000)::bigint as answered_us
    from poll_answer where poll_id=$1 and person_id=$2`,[row.id,actor.person.id]);
  if(!answer)return null;
  const intervals=await loadAudienceIntervals(exec,{personId:actor.person.id,isTest:actor.person.isTest,buildingIds:row.building_ids});
  const included=row.state!=="canceled" && (at>=Number(row.closes_us)
    ? audienceContinuousBefore(intervals,Number(answer.answered_us),Number(row.closes_us))
    : audienceContinuous(intervals,Number(answer.answered_us),at));
  return {option_key:answer.option_key,version:answer.version,answered_at:answer.answered_at,included};
}
export async function getPoll(deps:RegistryDeps,actor:Actor,id:string) {
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    const row=await requirePoll(exec,actor,id), clock=await serverClock(exec), resource=await pollResource(exec,actor,row,clock.us);
    return {...pollCard(row),own_answer:await ownAnswer(exec,actor,row,clock.us),can_manage:can(actor,"poll.manage",resource).allow,
      can_answer:can(actor,"poll.answer",resource).allow,can_results:can(actor,"poll.results",resource).allow};
  });
}
export async function answerPoll(deps:RegistryDeps,actor:Actor,id:string,input:Row,key:unknown) {
  const data=answerInput(input);
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    return idempotent(exec,actor,`poll.answer:${id}`,key,input,async()=>{
      const row=await pollRow(exec,id,true);
      const clock=await serverClock(exec);
      if(row.state!=="open" || clock.us>=Number(row.closes_us))throw new ApiError("INVALID_TRANSITION");
      if(!can(actor,"poll.answer",await pollResource(exec,actor,row,clock.us)).allow)throw new ApiError("NOT_FOUND");
      if(!row.options.some(option=>option.key===data.option_key))invalid("Вариант опроса не найден");
      const old=await ownAnswer(exec,actor,row,clock.us);
      checkVersion(old?.version??0,data.expected_version);
      if(old && !old.included){
        await exec.query("insert into poll_answer_log(poll_id,person_id,answer_version,action,at) values($1,$2,$3,'excluded',clock_timestamp()) on conflict do nothing",[id,actor.person.id,old.version]);
      }
      let updated:{option_key:string;version:number;answered_at:Date}|undefined;
      try {
        [updated]=await exec.query<{option_key:string;version:number;answered_at:Date}>(`insert into poll_answer(poll_id,person_id,option_key,version,answered_at)
          values($1,$2,$3,1,clock_timestamp()) on conflict(poll_id,person_id) do update
          set option_key=excluded.option_key,version=poll_answer.version+1,answered_at=clock_timestamp(),excluded_at=null
          returning option_key,version,answered_at`,[id,actor.person.id,data.option_key]);
      } catch(error){
        const message=error instanceof Error?error.message:"";
        if(message==="Poll answer period has ended")throw new ApiError("INVALID_TRANSITION");
        if(message==="Poll voter is not eligible")throw new ApiError("NOT_FOUND");
        throw error;
      }
      if(!updated)throw new Error("Ответ не сохранён");
      await exec.query("insert into poll_answer_log(poll_id,person_id,answer_version,action,option_key,at) values($1,$2,$3,'answer',$4,$5)",[id,actor.person.id,updated.version,updated.option_key,updated.answered_at]);
      await recordAudit(deps,exec,actor,"poll.answer","poll",id,row.building_ids,null,{answer_version:updated.version});
      return {poll_id:id,...updated,included:true};
    },async()=>{await requirePoll(exec,actor,id);});
  });
}
