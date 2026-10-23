import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { moderationRow } from "./moderation-access.ts";
import { ApiError } from "../../errors/api.ts";
/** Персональное решение сохраняет доступ после переезда; чужому получателю не доставляется. */
export async function moderationNoticeAllowed(exec:DbExecutor,actor:Actor,id:string) {
 try {const row=await moderationRow(exec,id);return actor.person.status==="active"&&row.target_person_id===actor.person.id&&row.is_test===actor.person.isTest;}
 catch(error){if(error instanceof ApiError&&error.code==="NOT_FOUND")return false;throw error;}
}
