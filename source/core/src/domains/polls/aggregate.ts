import type { DbExecutor } from "../../db/client.ts";
import { loadAudienceBatch } from "../registry/audience-history.ts";
import { calculatePollResult } from "./results.ts";
import type { PollRow } from "./access.ts";

/** Два чтения истории на весь набор, без N+1 запросов по людям. */
export async function aggregatePoll(exec:DbExecutor,row:PollRow,asOf:number) {
  const answers=await exec.query<{person_id:string;option_key:string;version:number;answered_us:string}>(`select person_id,option_key,version,(extract(epoch from answered_at)*1000000)::bigint as answered_us
    from poll_answer where poll_id=$1 order by person_id`,[row.id]);
  const histories=await loadAudienceBatch(exec,{isTest:row.is_test,buildingIds:row.building_ids},answers.map(a=>a.person_id));
  return calculatePollResult(row.options,answers.map(a=>({personId:a.person_id,optionKey:a.option_key,version:a.version,answeredAt:Number(a.answered_us)})),histories,asOf,asOf===Number(row.closes_us));
}
