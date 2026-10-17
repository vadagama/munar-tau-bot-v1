import { templateNotice } from "../../templates/notice.ts";
import {checkTimerContract,ruleContract} from "../timing/contracts.ts";
import type { NoticeText } from "../../templates/notice.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import {
  addRuleHours,
  ruleDeadline,
  type RuleParams,
} from "../registry/time.ts";
import { jsonValue } from "../registry/validation.ts";
import { enqueueNotice, recipientActor } from "../notifications/service.ts";
import { can } from "../../pdp/evaluate.ts";
import { TASK_SELECT, taskResource, type TaskRow } from "./access.ts";

export async function informTaskManagers(
  exec: DbExecutor,
  task: TaskRow,
  text: NoticeText,
  key: string,
  role?: string,
) {
  const people = await exec.query<{ person_id: string }>(
    "select distinct person_id from staff_assignment where status='active' and role in ('administrator','deputy','chairman')",
  );
  for (const person of people) {
    const actor = await recipientActor(exec, person.person_id);
    if (
      !actor || !can(actor, "task.manage", taskResource(task)).allow ||
      (role && !actor.assignments.some((a) => a.role === role))
    ) continue;
    await enqueueNotice(exec, {
      personId: person.person_id,
      text,
      key: `${key}:${person.person_id}`,
      taskId: task.id,
      audience: "staff",
      bot: "worker",
      buildingIds: task.building_ids,
      isTest: task.is_test,
    });
  }
}
/** Вызывается в транзакции перехода; только назначение запускает новую версию ожидания. */
export async function syncTaskTimers(
  exec: DbExecutor,
  row: TaskRow,
  from: string | null,
) {
  if (
    from && !["accepted_admin", "canceled"].includes(from) &&
    ["accepted_admin", "canceled"].includes(row.state)
  ) {
    // Пропуск сохраняется даже при завершении между двумя тиками jobs.
    await exec.query(
      "update task set overdue_at=coalesce(overdue_at,due_at) where id=$1 and due_at<=now()",
      [row.id],
    );
    await exec.query(
      "update job_run r set missed_at=coalesce(r.missed_at,t.overdue_at) from task t where r.task_id=t.id and t.id=$1 and t.overdue_at is not null",
      [row.id],
    );
  }
  if (row.state === "awaiting_acceptance" && from !== "awaiting_acceptance") {
    const deadline = await ruleDeadline(exec, "task_accept"),
      escalation = await ruleDeadline(exec, "task_escalation");
    await exec.query(
      "update task set acceptance_version=$2,acceptance_due_at=$3 where id=$1",
      [row.id, row.version, deadline.due],
    );
    await exec.query(
      "insert into timer(rule_version_id,entity_id,stage,due_at,payload) values ($1,$2,$3,$4,$5::text::jsonb) on conflict(entity_id,stage) do nothing",
      [
        deadline.id,
        row.id,
        `task_accept:${row.version}`,
        deadline.due,
        JSON.stringify({
          version: row.version,
          escalationRuleId: escalation.id,
        }),
      ],
    );
  } else if (row.state !== "awaiting_acceptance") {
    await exec.query(
      "update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage like 'task_%' and state='pending'",
      [row.id],
    );
  }
}
export async function sweepTaskTimers(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 30000,
) {
  return deps.db.transaction(async (exec) => {
    const timers = await exec.query<
      {
        id: string;
        rule_version_id: string;
        entity_id: string;
        stage: string;
        due_at: string;
        payload: unknown;
      }
    >(
      "select t.* from timer t join task k on k.id=t.entity_id where t.state='pending' and t.stage like 'task_%' and t.due_at<=$1 order by t.due_at for update of t,k skip locked limit 30",
      [now],
    );
    let count = 0;
    for (const timer of timers) {
      if (Date.now() >= deadline) break;
      await checkTimerContract(exec,timer.rule_version_id,timer.stage.startsWith("task_accept:") ? "task_accept" : "task_escalation");
      const [task] = await exec.query<TaskRow>(`${TASK_SELECT} where t.id=$1`, [
        timer.entity_id,
      ]);
      const payload = jsonValue<{ version: number; escalationRuleId: string }>(
        timer.payload,
      );
      const current = task?.state === "awaiting_acceptance" &&
        task.acceptance_version === payload.version;
      if (current) {
        const stage = timer.stage.split(":")[0];
        const role = stage === "task_accept"
          ? "administrator"
          : stage === "task_deputy"
          ? "deputy"
          : "chairman";
        await informTaskManagers(
          exec,
          task!,
          templateNotice("notices.tasks_timing_sweep_task_timers_101", {detail_a: task!.number}),
          `timer:${timer.id}`,
          role,
        );
        if (role !== "chairman") {
          const [v] = await exec.query<{ params: RuleParams }>(
            "select params from time_rule_version where id=$1",
            [payload.escalationRuleId],
          );
          ruleContract("task_escalation",v!.params);
          const due = addRuleHours(
            new Date(timer.due_at),
            jsonValue<RuleParams>(v!.params),
          );
          await exec.query(
            "insert into timer(rule_version_id,entity_id,stage,due_at,payload) values ($1,$2,$3,$4,$5::text::jsonb) on conflict(entity_id,stage) do nothing",
            [
              payload.escalationRuleId,
              task!.id,
              `${
                role === "administrator" ? "task_deputy" : "task_chairman"
              }:${payload.version}`,
              due,
              JSON.stringify(payload),
            ],
          );
        }
      }
      await exec.query(
        "update timer set state=$2,fired_at=case when $2='fired' then $3::timestamptz else null end,canceled_at=case when $2='canceled' then $3::timestamptz else null end where id=$1",
        [timer.id, current ? "fired" : "canceled", now],
      );
      count++;
    }
    const tasks = await exec.query<TaskRow>(
      `${TASK_SELECT} where t.state not in ('accepted_admin','canceled') and ((t.overdue_at is null and t.due_at<=$1) or (t.state='suspended' and t.next_action_at<=$1 and t.next_action_notified_at is distinct from t.next_action_at)) order by t.due_at for update of t skip locked limit 30`,
      [now],
    );
    for (const task of tasks) {
      if (Date.now() >= deadline) break;
      if (!task.overdue_at && new Date(String(task.due_at)) <= now) {
        await exec.query("update task set overdue_at=due_at where id=$1", [
          task.id,
        ]);
        await exec.query(
          "update job_run set missed_at=coalesce(missed_at,$2) where task_id=$1",
          [task.id, task.due_at],
        );
        await informTaskManagers(
          exec,
          task,
          templateNotice("notices.tasks_timing_sweep_task_timers_102", {task_number: task.number}),
          `task:${task.id}:overdue`,
        );
      }
      if (
        task.state === "suspended" && task.next_action_at &&
        new Date(String(task.next_action_at)) <= now &&
        String(task.next_action_notified_at) !== String(task.next_action_at)
      ) {
        await informTaskManagers(
          exec,
          task,
          templateNotice("notices.tasks_timing_sweep_task_timers_103", {task_number: task.number}),
          `task:${task.id}:next:${
            new Date(String(task.next_action_at)).toISOString()
          }`,
        );
        await exec.query(
          "update task set next_action_notified_at=next_action_at where id=$1",
          [task.id],
        );
      }
      count++;
    }
    return count;
  });
}
