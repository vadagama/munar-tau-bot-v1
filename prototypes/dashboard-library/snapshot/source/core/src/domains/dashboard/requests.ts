import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import { CURRENT_OVERDUE, MANAGER_REQUEST_SCOPE, managerRequestParams, UNREAD_MESSAGE } from "../requests/staff-queries.ts";
import { dashboardPeriod } from "./period.ts";

const attention = `(r.state not in ('draft','closed','canceled','rejected') and
 (${CURRENT_OVERDUE} or ${UNREAD_MESSAGE} or r.cancel_request is not null or
 exists(select 1 from task t where t.request_id=r.id and t.state='on_review') or
 exists(select 1 from task t where t.request_id=r.id and t.state='created' and
 (select l.meta->>'action' from task_log l where l.task_id=t.id order by l.id desc limit 1)='decline')))`;
export function requestFilters(input: Row) {
  const measure = String(input.measure ?? "created");
  if (!["created", "closed"].includes(measure)) throw new ApiError("VALIDATION_FAILED", "Неизвестный показатель");
  const from = input.from ? String(input.from) : null, to = input.to ? String(input.to) : null;
  if ([from, to].some(x => x && !Number.isFinite(Date.parse(x))) || (from && to && Date.parse(from) >= Date.parse(to))) throw new ApiError("VALIDATION_FAILED", "Некорректные даты");
  const queue = input.queue ? String(input.queue) : null;
  if (queue && !["new", "attention"].includes(queue)) throw new ApiError("VALIDATION_FAILED", "Неизвестная очередь");
  const kind = input.kind ? String(input.kind) : null;
  if (kind && !["request", "question", "complaint", "emergency"].includes(kind)) throw new ApiError("VALIDATION_FAILED", "Неизвестный вид обращения");
  const offset = Number(input.cursor ?? 0), limit = Number(input.limit ?? 100);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError("VALIDATION_FAILED", "Некорректная страница");
  return { measure, from, to, queue, kind, offset, limit };
}
/** All predicates apply before counting and paging; timestamps are half-open. */
export async function dashboardRequests(deps: RegistryDeps, actor: Actor, input: Row = {}) {
  const params = managerRequestParams(actor);
  const f = requestFilters(input);
  const date = f.measure === "closed" ? "r.closed_at" : "r.created_at";
  const selected = f.queue === "new" ? "r.state='new'" : f.queue === "attention" ? attention : "true";
  const rows = await deps.db.query<Row>(`select r.*, count(*) over() as dashboard_total,
    b.name as building_name,p.kind as premises_kind,p.number as premises_number,${CURRENT_OVERDUE} as current_overdue
    from request r left join building b on b.id=r.building_id left join premises p on p.id=r.premises_id
    where ${MANAGER_REQUEST_SCOPE} and ${selected}
    and ($6::timestamptz is null or ${date}>=$6) and ($7::timestamptz is null or ${date}<$7)
    and ($8::text is null or r.kind=$8) and ($9::text is null or r.state=$9)
    and ($10::text is null or r.building_id::text=$10)
    and ($11::text is null or r.number ilike '%'||$11||'%' or r.description ilike '%'||$11||'%')
    order by ${CURRENT_OVERDUE} desc,r.created_at,r.id limit $12 offset $13`,
    [...params, f.from, f.to, f.kind, input.state || null, input.building_id || null, input.search ? String(input.search).slice(0, 200) : null, f.limit, f.offset]);
  const total = Number(rows[0]?.dashboard_total ?? 0);
  return { items: rows.map(({ dashboard_total: _, ...row }) => row), total, next_cursor: f.offset + f.limit < total ? String(f.offset + f.limit) : null };
}
export async function dashboardAnalytics(deps: RegistryDeps, actor: Actor, period: unknown) {
  const params = managerRequestParams(actor);
  const range = dashboardPeriod(period);
  // Aggregate in PostgreSQL; no request descriptions or historical rows leave the database.
  const [result] = await deps.db.query<Row>(`with visible as (
      select r.created_at,r.closed_at,r.kind from request r where ${MANAGER_REQUEST_SCOPE}
      and ((r.created_at >= $6::timestamptz and r.created_at < $7::timestamptz)
        or (r.closed_at >= $6::timestamptz and r.closed_at < $7::timestamptz))
    ), buckets as (select * from jsonb_to_recordset($8::text::jsonb) as b(label text,"from" timestamptz,"to" timestamptz))
    select (select jsonb_agg(jsonb_build_object('label',b.label,'from',b."from",'to',b."to",
      'created',(select count(*) from visible v where v.created_at>=b."from" and v.created_at<b."to"),
      'closed',(select count(*) from visible v where v.closed_at>=b."from" and v.closed_at<b."to")) order by b."from") from buckets b) as buckets,
      (select jsonb_agg(jsonb_build_object('kind',k.kind,'count',(select count(*) from visible v where v.kind=k.kind and v.created_at >= $6::timestamptz and v.created_at < $7::timestamptz)))
       from unnest(array['request','question','complaint','emergency']) as k(kind)) as kinds`, [...params, range.from, range.to, JSON.stringify(range.buckets)]);
  return { ...range, buckets: result?.buckets ?? [], kinds: result?.kinds ?? [] };
}
