import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { requireRequest } from "./access.ts";
import { INCOMING_MESSAGE, requireRequestManager } from "./staff-queries.ts";
import { invalid, type Row } from "../registry/validation.ts";
export type TimelineSection = "messages" | "history" | "files" | "tasks";
export async function staffTimeline(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  section: TimelineSection,
  page = 0,
) {
  requireRequestManager(actor);
  try {
    await requireRequest(exec, actor, id, "request.manage");
  } catch (e) {
    if (e instanceof ApiError && e.code === "FORBIDDEN") {
      throw new ApiError("NOT_FOUND");
    }
    throw e;
  }
  if (!Number.isSafeInteger(page) || page < 0) invalid("Некорректная страница");
  const query: Record<TimelineSection, string> = {
    messages:
      `select m.*,n.full_name as author_name,${INCOMING_MESSAGE} as incoming from message m join request r on r.id=m.request_id left join person n on n.id=m.author_person_id where m.request_id=$1 and m.restricted_at is null order by m.created_at desc,m.id desc limit 11 offset $3`,
    history:
      `select id,from_state,to_state,reason,at from request_log where request_id=$1 and $2::uuid is not null order by at desc,id desc limit 11 offset $3`,
    files:
      `select id,filename,status,size_bytes,bucket from attachment where request_id=$1 and (owner_type='message' or uploaded_by=$2) and (owner_type<>'message' or exists(select 1 from message where id=attachment.owner_id and restricted_at is null)) order by created_at desc,id desc limit 11 offset $3`,
    tasks:
      `select t.id,t.number,t.title,t.state,t.version,t.due_at,p.full_name as assignee_name from task t left join person p on p.id=t.assignee_person_id where t.request_id=$1 and $2::uuid is not null order by t.created_at desc,t.id desc limit 11 offset $3`,
  };
  if (!Object.hasOwn(query, section)) throw new ApiError("VALIDATION_FAILED");
  const rows = await exec.query<Row>(query[section], [
    id,
    actor.person.id,
    page * 10,
  ]);
  return { items: rows.slice(0, 10), has_more: rows.length > 10 };
}
export async function markStaffRead(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  ids: unknown,
) {
  requireRequestManager(actor);
  try {
    await requireRequest(exec, actor, id, "request.manage");
  } catch (e) {
    if (e instanceof ApiError && e.code === "FORBIDDEN") {
      throw new ApiError("NOT_FOUND");
    }
    throw e;
  }
  if (
    !Array.isArray(ids) || ids.length > 10 ||
    ids.some((v) => typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v))
  ) invalid("Некорректные сообщения");
  if (!ids.length) return;
  const rows = await exec.query<{ id: string }>(
    `select m.id from message m join request r on r.id=m.request_id where m.request_id=$1 and m.channel='resident' and m.restricted_at is null and ${INCOMING_MESSAGE} and m.id=any($3::uuid[])`,
    [id, actor.person.id, ids],
  );
  if (rows.length !== new Set(ids).size) throw new ApiError("NOT_FOUND");
  await exec.query(
    `insert into request_message_read(person_id,message_id) select $1,u.id from unnest($2::uuid[]) u(id) on conflict do nothing`,
    [actor.person.id, ids],
  );
}
