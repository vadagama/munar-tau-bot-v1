import type { DbExecutor } from "../../db/client.ts";
import type { Actor, ResourceRef } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
import { audienceEligible, loadAudienceIntervals } from "../registry/audience-history.ts";
import type { PollOption } from "./input.ts";

export interface PollRow extends Row {
  id:string; question:string; options:PollOption[]; building_ids:string[];
  state:"draft"|"open"|"closed"|"canceled"; is_test:boolean; version:number;
  buildings?:{id:string;label:string}[];
  closes_at:Date|string; closes_us:string; cancel_reason:string|null;
}
export async function serverClock(exec:DbExecutor) {
  const [row]=await exec.query<{at:Date;us:string}>(`with clock as materialized(select clock_timestamp() as at)
    select at,(extract(epoch from at)*1000000)::bigint as us from clock`);
  if(!row) throw new Error("Серверное время недоступно");
  return {at:row.at,us:Number(row.us)};
}
export async function pollRow(exec:DbExecutor,id:string,lock=false):Promise<PollRow> {
  const [row]=await exec.query<PollRow>(`select p.*,(extract(epoch from p.closes_at)*1000000)::bigint as closes_us,
    coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',coalesce(b.name,'Здание '||b.code)) order by b.code)
      from building b where b.id=any(p.building_ids)),'[]'::jsonb) as buildings from poll p where p.id=$1${lock?" for update":""}`,[id]);
  if(!row) throw new ApiError("NOT_FOUND");
  row.options=jsonValue<PollOption[]>(row.options);
  return row;
}
export async function pollResource(exec:DbExecutor,actor:Actor,row:PollRow,now:number):Promise<ResourceRef> {
  if(row.is_test!==actor.person.isTest) throw new ApiError("NOT_FOUND");
  const intervals=await loadAudienceIntervals(exec,{personId:actor.person.id,isTest:actor.person.isTest,buildingIds:row.building_ids});
  const own=await exec.query("select 1 from poll_answer where poll_id=$1 and person_id=$2",[row.id,actor.person.id]);
  const finalParticipant=row.state==="closed" && (await exec.query("select 1 from poll_result_participant where poll_id=$1 and person_id=$2",[row.id,actor.person.id])).length>0;
  return {pollAccess:{buildingIds:row.building_ids,isTest:row.is_test,state:row.state,
    member:audienceEligible(intervals,now),participant:own.length>0,finalParticipant,
    answerOpen:row.state==="open" && now<Number(row.closes_us)}};
}
export async function requirePoll(exec:DbExecutor,actor:Actor,id:string,action:"poll.read"|"poll.manage"|"poll.answer"|"poll.results"="poll.read",lock=false) {
  const row=await pollRow(exec,id,lock), clock=await serverClock(exec);
  if(!can(actor,action,await pollResource(exec,actor,row,clock.us)).allow) throw new ApiError("NOT_FOUND");
  return row;
}
export function pollCard(row:PollRow) {
  return {id:row.id,question:row.question,options:row.options,building_ids:row.building_ids,buildings:jsonValue<{id:string;label:string}[]>(row.buildings??[]),
    closes_at:row.closes_at,state:row.state,version:row.version,cancel_reason:row.cancel_reason,
    informational:true};
}
