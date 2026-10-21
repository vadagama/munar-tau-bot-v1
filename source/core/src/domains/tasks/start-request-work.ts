import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { requireRequest } from "../requests/access.ts";
import { checkVersion } from "../requests/fsm.ts";
import { content, idempotent, transitionRequestInTransaction } from "../requests/service.ts";
import { requireTask } from "./access.ts";
import { createTaskInTransaction, dateInput } from "./service.ts";

/** Задание, переход и outbox фиксируются вместе, включая защиту от повторов. */
async function startWork(
  deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown, action: "start_work" | "plan_rework",
): Promise<Row> {
  return deps.db.transaction(exec => idempotent(
    exec, actor, `requests/${id}/${action === "start_work" ? "start-work" : "plan-rework"}`, key, input,
    async () => {
      const request = await requireRequest(exec, actor, id, "request.manage", true);
      checkVersion(request.version, input.expected_version);
      const instruction = content(input.plan, "описание работы");
      const assignee = content(input.assignee_person_id, "исполнителя");
      const due = dateInput(input.due_at);
      if (Date.parse(due) <= Date.now()) invalid("Срок задания должен быть в будущем");
      const [place] = await exec.query<{ label: string }>(
        `select concat_ws(', ', b.name, case p.kind when 'apartment' then 'квартира' when 'commercial' then 'коммерческое помещение' when 'parking_slot' then 'парковочное место' when 'storage' then 'кладовка' end, p.number, $3::text) as label from building b left join premises p on p.id=$2 where b.id=$1`,
        [request.building_id, request.premises_id, request.location_text ?? null],
      );
      const task = await createTaskInTransaction(deps, exec, actor, {
        request_id: id,
        title: `Обращение ${request.number}`,
        instruction: `${place?.label || request.location_text || "Общая территория"}\n\n${instruction}`,
        assignee_person_id: assignee,
        due_at: due,
        is_required: true,
      });
      // Вопрос/жалоба с обязательным заданием тоже требует принятого результата.
      await exec.query("update request set work_execution_required=true where id=$1", [id]);
      const next = await transitionRequestInTransaction(deps, exec, actor, id, {
        action, expected_version: input.expected_version,
        payload: { plan: instruction, task_id: task.id },
      });
      return { request: next, task };
    },
    async response => {
      await requireRequest(exec, actor, id, "request.manage");
      await requireTask(exec, actor, String((response.task as Row).id), "task.manage");
    },
  ));
}

export function startRequestWork(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  return startWork(deps,actor,id,input,key,"start_work");
}
export function planRequestRework(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown) {
  return startWork(deps,actor,id,input,key,"plan_rework");
}
