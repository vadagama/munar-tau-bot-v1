import type { DbExecutor } from "../../db/client.ts";
import { enqueueNotice,enqueueNoticeBatch } from "../notifications/service.ts";
import type { InitiativeRow } from "./types.ts";
/** Область каждого управляющего повторно проверяется диспетчером и доставкой. */
export async function enqueueInitiativeReview(exec:DbExecutor,row:InitiativeRow) {
 const people=await exec.query<{id:string}>(`select distinct p.id from person p join staff_assignment a on a.person_id=p.id
  where p.status='active' and p.is_test=$1 and a.status='active' and a.role in ('chairman','administrator','deputy')
  and (a.valid_from is null or a.valid_from<=clock_timestamp()) and (a.valid_until is null or a.valid_until>clock_timestamp())`,[row.is_test]);
 await enqueueNoticeBatch(exec,people.map(p=>({personId:p.id,key:`initiative.review:${row.id}:${p.id}`,template:"notices.initiatives.review",vars:{title:row.title,reason:""},
  initiativeId:row.id,initiativeReview:true,type:"personal",audience:"personal",bot:"worker",isTest:row.is_test})));
}
export async function enqueueInitiativeState(exec:DbExecutor,row:InitiativeRow) {
 await enqueueNotice(exec,{personId:row.author_person_id,key:`initiative.state:${row.id}:${row.version}`,template:`notices.initiatives.state.${row.stage??row.publication_state}`,
  vars:{title:row.title,reason:row.stage_reason??row.review_reason??""},initiativeId:row.id,initiativeReview:false,type:"personal",audience:"personal",bot:"resident",isTest:row.is_test});
}
