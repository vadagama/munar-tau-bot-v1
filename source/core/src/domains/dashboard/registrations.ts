import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { registryScope } from "../registry/access.ts";
import type { Row } from "../registry/validation.ts";
import { dashboardPeriod } from "./period.ts";

/**
 * Рост базы жителей: подтверждённые регистрации (анкеты без помещения) и
 * привязки помещений за период, по дате решения. Скоуп как у listRegistrations:
 * анкеты без помещения видны целиком, привязки — по домовой области.
 */
export async function dashboardRegistrationsAnalytics(deps: RegistryDeps, actor: Actor, period: unknown) {
  if (!can(actor, "registration.review").allow) throw new ApiError("FORBIDDEN");
  const scope = actor.assignments.some(a => a.role === "tech_admin") ? null
    : registryScope(actor);
  const range = dashboardPeriod(period);
  const [result] = await deps.db.query<Row>(`with visible as (
      select r.decided_at,(r.premises_id is not null) as binding
      from registration r left join premises p on p.id=r.premises_id
      where r.is_test=$1 and r.superseded_by is null and r.state='approved' and r.decided_at is not null
      and ($2::uuid[] is null or r.premises_id is null or p.building_id=any($2::uuid[]))
      and r.decided_at >= $3::timestamptz and r.decided_at < $4::timestamptz
    ), buckets as (select * from jsonb_to_recordset($5::text::jsonb) as b(label text,"from" timestamptz,"to" timestamptz))
    select (select jsonb_agg(jsonb_build_object('label',b.label,'from',b."from",'to',b."to",
      'primary',(select count(*) from visible v where not v.binding and v.decided_at>=b."from" and v.decided_at<b."to"),
      'binding',(select count(*) from visible v where v.binding and v.decided_at>=b."from" and v.decided_at<b."to")) order by b."from") from buckets b) as buckets`,
    [actor.person.isTest, scope, range.from, range.to, JSON.stringify(range.buckets)]);
  return { ...range, buckets: result?.buckets ?? [] };
}
