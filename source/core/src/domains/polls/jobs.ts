import type { RegistryDeps } from "../registry/service.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { pollRow,serverClock } from "./access.ts";
import { aggregatePoll } from "./aggregate.ts";
import { enqueueNoticeBatch } from "../notifications/service.ts";
import { templateNotice } from "../../templates/notice.ts";
import type { DbExecutor } from "../../db/client.ts";

/** Вызывается только внутри gate-транзакции; индивидуальные данные — закрытый журнал. */
export async function persistExclusions(exec:DbExecutor,pollId:string,excluded:readonly {personId:string;version:number;lostAt:number}[]) {
  if(!excluded.length)return;
  const data=JSON.stringify(excluded.map(e=>({person_id:e.personId,answer_version:e.version,lost_us:e.lostAt})));
  await exec.query(`insert into poll_answer_log(poll_id,person_id,answer_version,action,at)
    select $1,x.person_id,x.answer_version,'excluded',poll_instant(x.lost_us)
    from jsonb_to_recordset($2::text::jsonb) x(person_id uuid,answer_version integer,lost_us bigint)
    on conflict do nothing`,[pollId,data]);
  await exec.query(`update poll_answer a set excluded_at=poll_instant(x.lost_us)
    from jsonb_to_recordset($2::text::jsonb) x(person_id uuid,answer_version integer,lost_us bigint)
    where a.poll_id=$1 and a.person_id=x.person_id and a.version=x.answer_version and a.excluded_at is null`,[pollId,data]);
}
export async function closePollById(deps:RegistryDeps,id:string,deadline=Date.now()+30000):Promise<boolean> {
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    if(Date.now()>=deadline)return false;
    const row=await pollRow(exec,id,true),clock=await serverClock(exec);
    if(row.state!=="open" || clock.us<Number(row.closes_us))return false;
    const result=await aggregatePoll(exec,row,Number(row.closes_us));
    await exec.query(`insert into poll_result(poll_id,as_of,participants_count,distribution)
      select id,closes_at,$2,$3::text::jsonb from poll where id=$1`,[id,result.summary.participants_count,JSON.stringify(result.summary.distribution)]);
    if(result.participantIds.length)await exec.query("insert into poll_result_participant(poll_id,person_id) select $1,unnest($2::uuid[])",[id,result.participantIds]);
    await persistExclusions(exec,id,result.excluded);
    await exec.query("update poll set state='closed',closed_at=clock_timestamp(),version=version+1 where id=$1",[id]);
    await deps.audit.append(exec,{actorPersonId:null,actorProfileId:null,emulationSessionId:null,emulatedPersonId:null,
      action:"poll.close",entityType:"poll",entityId:id,before:{state:"open"},after:{state:"closed",participants_count:result.summary.participants_count},
      reason:"Завершение информационного опроса по сроку",scopeBuildings:row.building_ids,meta:{}});
    await enqueueNoticeBatch(exec,result.participantIds.map(personId=>({personId,key:`poll.closed:${id}:${personId}`,
      text:templateNotice("notices.polls.closed",{question:row.question,reason:""}),pollId:id,pollEvent:"closed",type:"personal",audience:"personal",bot:"resident",isTest:row.is_test})));
    return true;
  });
}
export async function closeDuePolls(deps:RegistryDeps,deadline=Date.now()+30000):Promise<number> {
  if(Date.now()>=deadline)return 0;
  const rows=await deps.db.query<{id:string}>("select id from poll where state='open' and closes_at<=clock_timestamp() order by closes_at,id limit 10");
  let processed=0;
  for(const row of rows){
    if(Date.now()+1000>=deadline)break;
    if(await closePollById(deps,row.id,deadline))processed++;
  }
  return processed;
}
