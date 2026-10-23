import type { DbExecutor } from "../../db/client.ts";
import { audienceContinuous,audienceContinuousBefore,loadAudienceBatch,type AudienceInterval } from "../registry/audience-history.ts";
import type { InitiativeRow } from "./types.ts";
interface SupportRow {person_id:string;version:number;supported_us:string}
/** Внутренний расчёт: персональный состав не является DTO инициативы. */
export function calculateSupport(rows:readonly SupportRow[],histories:ReadonlyMap<string,readonly AudienceInterval[]>,at:number,final=false) {
  const people:string[]=[],excluded:{personId:string;version:number;lostAt:number}[]=[];
  for(const row of rows){
    const intervals=histories.get(row.person_id)??[],started=Number(row.supported_us);
    const included=final?audienceContinuousBefore(intervals,started,at):audienceContinuous(intervals,started,at);
    if(included)people.push(row.person_id);
    else {
      const interval=intervals.find(i=>i.from<=started && started<i.until);
      excluded.push({personId:row.person_id,version:row.version,lostAt:Math.min(interval?.until??started,at)});
    }
  }
  return {count:people.length,people,excluded};
}
export async function initiativeSupportState(exec:DbExecutor,row:InitiativeRow,at:number,final=false) {
  const rows=await exec.query<SupportRow>(`select person_id,version,(extract(epoch from supported_at)*1000000)::bigint as supported_us
    from initiative_support where initiative_id=$1 and withdrawn_at is null order by person_id`,[row.id]);
  const histories=await loadAudienceBatch(exec,{isTest:row.is_test,buildingIds:row.approved_building_ids},rows.map(r=>r.person_id));
  return calculateSupport(rows,histories,at,final);
}

export async function persistInitiativeExclusions(exec:DbExecutor,id:string,excluded:readonly {personId:string;version:number;lostAt:number}[]) {
  if(!excluded.length)return;
  const data=JSON.stringify(excluded.map(e=>({person_id:e.personId,support_version:e.version,lost_us:e.lostAt})));
  await exec.query(`insert into initiative_support_log(initiative_id,person_id,support_version,action,at)
    select $1,x.person_id,x.support_version,'excluded',poll_instant(x.lost_us)
    from jsonb_to_recordset($2::text::jsonb) x(person_id uuid,support_version integer,lost_us bigint) on conflict do nothing`,[id,data]);
  await exec.query(`update initiative_support s set excluded_at=poll_instant(x.lost_us)
    from jsonb_to_recordset($2::text::jsonb) x(person_id uuid,support_version integer,lost_us bigint)
    where s.initiative_id=$1 and s.person_id=x.person_id and s.version=x.support_version and s.excluded_at is null`,[id,data]);
}
