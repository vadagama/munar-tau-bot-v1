import { requireTask } from "../tasks/access.ts";
import { registryScope } from "../registry/access.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { requireRequest } from "../requests/access.ts";
import { jsonValue, type Row } from "../registry/validation.ts";
async function failureAllowed(exec: DbExecutor, actor: Actor, n: Row) {
  if (
    !can(actor, "notification.failures").allow ||
    actor.person.isTest !== n.is_test
  ) return false;
  if (n.task_id) {
    try {
      await requireTask(exec, actor, String(n.task_id), "task.manage");
      return true;
    } catch (e) {
      if (
        e instanceof ApiError && ["FORBIDDEN", "NOT_FOUND"].includes(e.code)
      ) return false;
      throw e;
    }
  }
  if (n.request_id) {
    try {
      await requireRequest(exec, actor, String(n.request_id), "request.manage");
      return true;
    } catch (e) {
      if (
        e instanceof ApiError && ["FORBIDDEN", "NOT_FOUND"].includes(e.code)
      ) return false;
      throw e;
    }
  }
  const buildings =
    jsonValue<{ buildingIds?: string[] }>(n.event_ref).buildingIds ?? [];
  return actor.assignments.some((a) =>
    a.role === "chairman" ||
    (["administrator", "deputy"].includes(a.role) && buildings.length > 0 &&
      buildings.every((id) => a.scopeBuildingIds?.includes(id)))
  );
}
export async function listFailures(exec: DbExecutor, actor: Actor) {
  if (!can(actor, "notification.failures").allow) {
    throw new ApiError("FORBIDDEN");
  }
  const scope = registryScope(actor);
  const all = await exec.query<Row>(
    `select n.id,n.recipient_person_id,n.event_type,n.event_ref,n.request_id,n.task_id,n.is_test,n.attempts,n.last_error,n.created_at,f.id as followup_id,f.state as followup_state,f.result,f.completed_at from notification n left join request r on r.id=n.request_id left join notification_followup f on f.notification_id=n.id where n.state='failed' and n.is_test=$1 and ($2::uuid[] is null or (r.building_id=any($2::uuid[]) and r.complaint_route<>'chairman' and r.complaint_subject_person_id is distinct from $3::uuid) or (n.request_id is null and exists(select 1 from jsonb_array_elements_text(coalesce(n.event_ref->'buildingIds','[]'::jsonb)) b where b::uuid=any($2::uuid[])))) order by n.created_at desc limit 200`,
    [actor.person.isTest, scope, actor.person.id],
  );
  const items: Row[] = [];
  for (const row of all) {
    if (await failureAllowed(exec, actor, row)) {
      const [person] = row.recipient_person_id
        ? await exec.query<Row>(
          "select full_name,phone_e164 from person where id=$1",
          [row.recipient_person_id],
        )
        : [];
      items.push({ ...row, ...person });
    }
  }
  return { items };
}
export async function completeFollowup(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  result: unknown,
) {
  if (typeof result !== "string" || !result.trim() || result.length > 1000) {
    throw new ApiError("VALIDATION_FAILED", "Запишите результат попытки связи");
  }
  return deps.db.transaction(async (exec) => {
    const [row] = await exec.query<Row>(
      "select n.*,f.state as followup_state from notification_followup f join notification n on n.id=f.notification_id where f.id=$1 for update of f",
      [id],
    );
    if (!row || !await failureAllowed(exec, actor, row)) {
      throw new ApiError("NOT_FOUND");
    }
    if (row.followup_state === "done") {
      throw new ApiError("CONCURRENT_MODIFICATION");
    }
    await exec.query(
      "update notification_followup set state='done',result=$2,completed_at=now(),completed_by=$3 where id=$1",
      [id, result.trim(), actor.person.id],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "notification.followup.completed",
      "notification_followup",
      id,
      [],
      { state: "open" },
      { state: "done" },
    );
    return { state: "done" };
  });
}
