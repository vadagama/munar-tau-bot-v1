import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { pollRow,pollResource,serverClock } from "./access.ts";
import { ApiError } from "../../errors/api.ts";

/** Повторная проверка перед outbox/digest/delivery, без чтения распределения. */
export async function pollNoticeAllowed(exec:DbExecutor,actor:Actor,id:string,event:"opened"|"closed"|"canceled"):Promise<boolean> {
  try{
    if(actor.person.status!=="active")return false;
    const row=await pollRow(exec,id),clock=await serverClock(exec),resource=await pollResource(exec,actor,row,clock.us);
    const r=resource.pollAccess!;
    if(event==="closed")return row.state==="closed" && r.finalParticipant;
    if(event==="canceled")return row.state==="canceled" && r.participant;
    return row.state==="open" && r.member && r.answerOpen;
  }catch(error){if(error instanceof ApiError && error.code==="NOT_FOUND")return false;throw error;}
}
