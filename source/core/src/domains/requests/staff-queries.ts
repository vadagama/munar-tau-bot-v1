import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { STATES } from "./fsm.ts";

export function requireRequestManager(actor: Actor): void {
  if (
    actor.person.status !== "active" ||
    !actor.assignments.some((a) =>
      ["chairman", "administrator", "deputy"].includes(a.role)
    )
  ) throw new ApiError("FORBIDDEN");
}
export const CURRENT_OVERDUE =
  `(r.state not in ('draft','closed','canceled','rejected') and
 ((r.first_response_at is null and r.first_response_due_at<now()) or
 (r.state<>'awaiting_confirmation' and r.due_at<now())))`;
export const INCOMING_MESSAGE =
  `(m.author_person_id<>$2 and (m.author_person_id=r.author_person_id or exists
 (select 1 from request_participant rp where rp.request_id=r.id and rp.person_id=m.author_person_id and rp.role='participant')))`;
export const UNREAD_MESSAGE =
  `exists(select 1 from message m where m.request_id=r.id and m.channel='resident'
 and m.restricted_at is null and ${INCOMING_MESSAGE} and not exists
 (select 1 from request_message_read rd where rd.message_id=m.id and rd.person_id=$2))`;
const NEEDS_REVIEW =
  `exists(select 1 from task t where t.request_id=r.id and t.state='on_review')`;
const DECLINED =
  `exists(select 1 from task t where t.request_id=r.id and t.state='created' and
 (select l.meta->>'action' from task_log l where l.task_id=t.id order by l.id desc limit 1)='decline')`;

export async function listStaffRequests(
  exec: DbExecutor,
  actor: Actor,
  filter: Row = {},
) {
  requireRequestManager(actor);
  const queue = String(filter.queue ?? "new");
  if (!["new", "unassigned", "attention", "mine", "all"].includes(queue)) {
    invalid("Неизвестная очередь");
  }
  const limit = Number(filter.limit ?? 10);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    invalid("Некорректный размер страницы");
  }
  const state = filter.state ? String(filter.state) : null;
  if (
    state &&
    (!STATES.includes(state as typeof STATES[number]) || state === "draft")
  ) invalid("Некорректный статус");
  const building = filter.building_id ? String(filter.building_id) : null;
  if (building && building !== "none" && !/^[0-9a-f-]{36}$/i.test(building)) {
    invalid("Некорректный дом");
  }
  const from = filter.from ? String(filter.from) : null,
    to = filter.to ? String(filter.to) : null;
  if ([from, to].some((v) => v && !Number.isFinite(Date.parse(v)))) {
    invalid("Некорректный период");
  }
  const search = filter.search
    ? String(filter.search).trim().slice(0, 200)
    : null;
  const signature = JSON.stringify([
    queue,
    state,
    building,
    from,
    to,
    search,
    limit,
  ]);
  let offset = 0;
  if (filter.cursor) {
    try {
      const data = JSON.parse(decodeURIComponent(atob(String(filter.cursor))));
      if (
        data.signature !== signature || !Number.isSafeInteger(data.offset) ||
        data.offset < 0
      ) invalid("Некорректная страница");
      offset = data.offset;
    } catch {
      invalid("Некорректная страница");
    }
  }
  const managers = actor.assignments.filter((a) =>
    ["chairman", "administrator", "deputy"].includes(a.role)
  );
  const allArea = false; // Match request.manage: only chairman has implicit access to every building.
  const chairman = managers.some((a) => a.role === "chairman");
  const scopes = [
    ...new Set(managers.flatMap((a) => a.scopeBuildingIds ?? [])),
  ];
  const open = `r.state not in ('draft','closed','canceled','rejected')`;
  const selection: Record<string, string> = {
    new: `r.state='new'`,
    unassigned:
      `${open} and not exists(select 1 from task t where t.request_id=r.id)`,
    mine: `${open} and r.assigned_admin_person_id=$2`,
    all: `r.state<>'draft'`,
    attention:
      `${open} and (${CURRENT_OVERDUE} or ${UNREAD_MESSAGE} or ${NEEDS_REVIEW} or ${DECLINED} or r.cancel_request is not null)`,
  };
  const rows = await exec.query<Row>(
    `select r.*,${CURRENT_OVERDUE} as current_overdue,${UNREAD_MESSAGE} as unread,
     ${NEEDS_REVIEW} as report_pending,${DECLINED} as assignment_declined,
     (select full_name from person where id=r.assigned_admin_person_id) as manager_name,
     coalesce((select name from building where id=r.building_id),r.location_text) as place_label
     from request r where r.is_test=$1 and r.state<>'draft'
     and r.complaint_subject_person_id is distinct from $2::uuid
     and ($3 or (r.complaint_route<>'chairman' and ($4 or r.building_id is null or r.building_id=any($5::uuid[]))))
     and (${selection[queue]}) and ($6::text is null or r.state=$6)
     and ($7::text is null or ($7='none' and r.building_id is null) or r.building_id::text=$7)
     and ($8::timestamptz is null or r.created_at >= $8) and ($9::timestamptz is null or r.created_at <= $9)
     and ($10::text is null or r.number ilike '%'||$10||'%' or r.description ilike '%'||$10||'%' or exists
       (select 1 from message m where m.request_id=r.id and m.restricted_at is null and m.channel='resident' and m.text ilike '%'||$10||'%'))
     order by ${CURRENT_OVERDUE} desc,r.created_at,r.id limit $11 offset $12`,
    [
      actor.person.isTest,
      actor.person.id,
      chairman,
      allArea,
      scopes,
      state,
      building,
      from,
      to,
      search,
      limit + 1,
      offset,
    ],
  );
  return {
    items: rows.slice(0, limit),
    next_cursor: rows.length > limit
      ? btoa(
        encodeURIComponent(
          JSON.stringify({ signature, offset: offset + limit }),
        ),
      )
      : null,
  };
}
