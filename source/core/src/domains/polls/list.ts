import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid,jsonValue } from "../registry/validation.ts";
import { lockAudience } from "../registry/audience-lock.ts";
import { pollCard,type PollRow } from "./access.ts";
import type { PollOption } from "./input.ts";
interface ListRow extends PollRow {is_member:boolean;participated:boolean;final_participant:boolean;now_us:string}
export async function listPolls(deps:RegistryDeps,actor:Actor,options:{offset?:number;limit?:number;state?:string}={}) {
  const offset=options.offset??0,limit=options.limit??20,state=options.state??null;
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit)||limit<1||limit>50||
    (state!==null&&!["draft","open","closed","canceled"].includes(state)))invalid("Некорректная страница или состояние опросов");
  return deps.db.transaction(async exec=>{
    await lockAudience(exec);
    // Только признаки участия. Ни варианты ответов, ни персональный состав
    // не выбираются даже для административного списка.
    const rows=await exec.query<ListRow>(`with clock as materialized(select clock_timestamp() as at)
      select p.*,(extract(epoch from p.closes_at)*1000000)::bigint as closes_us,
      (extract(epoch from clock.at)*1000000)::bigint as now_us,
      exists(select 1 from poll_answer a where a.poll_id=p.id and a.person_id=$1) as participated,
      exists(select 1 from poll_result_participant r where r.poll_id=p.id and r.person_id=$1) as final_participant,
      exists(select 1 from connection c join premises m on m.id=c.premises_id join person v on v.id=c.person_id
        where c.person_id=$1 and c.status='active' and v.status='active' and v.is_test=p.is_test
        and m.status='active' and m.is_test=p.is_test and m.building_id=any(p.building_ids)
        and (c.start_date is null or c.start_date<=(clock.at at time zone 'Asia/Almaty')::date)
        and (c.end_date is null or c.end_date>=(clock.at at time zone 'Asia/Almaty')::date)
        and exists(select 1 from profile f where f.person_id=v.id and f.archived_at is null and f.is_test=p.is_test)) as is_member
      from poll p cross join clock where p.is_test=$2 and ($3::text is null or p.state=$3)
      order by p.created_at desc,p.id`,[actor.person.id,actor.person.isTest,state]);
    const allowed=rows.flatMap(row=>{
      const resource={pollAccess:{buildingIds:row.building_ids,isTest:row.is_test,state:row.state,member:row.is_member,
        participant:row.participated,finalParticipant:row.final_participant,answerOpen:row.state==="open"&&Number(row.now_us)<Number(row.closes_us)}};
      if(!can(actor,"poll.read",resource).allow)return [];
      row.options=jsonValue<PollOption[]>(row.options);
      return [{...pollCard(row),can_manage:can(actor,"poll.manage",resource).allow,
        can_answer:can(actor,"poll.answer",resource).allow,can_results:can(actor,"poll.results",resource).allow}];
    });
    return {items:allowed.slice(offset,offset+limit),has_more:allowed.length>offset+limit};
  });
}
