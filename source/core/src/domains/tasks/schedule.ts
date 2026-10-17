import { templateNotice } from "../../templates/notice.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { recordAudit } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { recipientActor } from "../notifications/service.ts";
import { createCommonWork, managesArea } from "./common.ts";
import { createTask } from "./service.ts";
import { TASK_SELECT, type TaskRow } from "./access.ts";
import { informTaskManagers } from "./timing.ts";
import { retryPolicy } from "../notifications/policy.ts";

export function scheduleInput(input: Row) {
  if (
    typeof input.enabled !== "boolean" ||
    !Number.isInteger(input.interval_hours) ||
    Number(input.interval_hours) < 1 || Number(input.interval_hours) > 8784 ||
    !Number.isInteger(input.due_hours) || Number(input.due_hours) < 1 ||
    Number(input.due_hours) > 8784
  ) {
    invalid(
      "Укажите период и срок выполнения в целых календарных часах (1–8784)",
    );
  }
  if (
    typeof input.next_run_at !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(input.next_run_at) ||
    !Number.isFinite(Date.parse(input.next_run_at))
  ) invalid("Укажите дату первого запуска");
  if (
    input.assignee_person_id != null &&
    (typeof input.assignee_person_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.assignee_person_id))
  ) invalid("Некорректный исполнитель");
  return {
    enabled: input.enabled,
    intervalHours: Number(input.interval_hours),
    dueHours: Number(input.due_hours),
    next: new Date(input.next_run_at as string),
    assignee: input.assignee_person_id ?? null,
  };
}
export async function scheduleView(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const [template] = await deps.db.query<Row>(
    "select * from job_template where id=$1",
    [id],
  );
  if (
    !template ||
    !managesArea(
      actor,
      template.buildings as string[],
      Boolean(template.is_test),
    )
  ) throw new ApiError("FORBIDDEN");
  const [schedule] = await deps.db.query<Row>(
    "select * from job_schedule where template_id=$1",
    [id],
  );
  const storedRuns = await deps.db.query<Row>(
    `select r.*,q.state,q.last_error,q.attempts,t.number,t.state as task_state,t.due_at,t.overdue_at,q.payload as access_payload,t.is_test as task_is_test,case when t.request_id is not null then array_remove(array[request.building_id],null) else work.building_ids end as task_buildings from job_run r join job_queue q on q.id=r.queue_id left join task t on t.id=r.task_id left join request on request.id=t.request_id left join common_work work on work.id=t.common_work_id where r.template_id=$1 order by r.scheduled_at desc limit 100`,
    [id],
  );
  const runs = storedRuns.flatMap(
    ({ access_payload, task_is_test, task_buildings, ...run }) => {
      const snapshot = jsonValue<RunPayload>(access_payload);
      return managesArea(
          actor,
          run.task_id ? task_buildings as string[] : snapshot.buildings,
          run.task_id ? Boolean(task_is_test) : snapshot.isTest,
        )
        ? [run]
        : [];
    },
  );
  const assignees = await deps.db.query<Row>(
    `select distinct p.id,p.full_name from person p join staff_assignment a on a.person_id=p.id where p.status='active' and p.is_test=$1 and a.role='executor' and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and not exists(select 1 from unnest($2::uuid[]) b(id) where not exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=b.id)) order by p.full_name`,
    [template.is_test, template.buildings],
  );
  return { schedule: schedule ?? null, runs, assignees };
}
export async function saveSchedule(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
) {
  const p = scheduleInput(input);
  return deps.db.transaction(async (exec) => {
    const [t] = await exec.query<Row>(
      "select * from job_template where id=$1 for update",
      [id],
    );
    if (
      !t || !managesArea(actor, t.buildings as string[], Boolean(t.is_test))
    ) throw new ApiError("FORBIDDEN");
    if (!t.active && p.enabled) {
      invalid("Включите шаблон перед настройкой расписания");
    }
    if (p.enabled && p.assignee) {
      const assignee = await recipientActor(exec, String(p.assignee));
      if (
        !assignee || assignee.person.isTest !== actor.person.isTest ||
        !assignee.assignments.some((a) =>
          a.role === "executor" &&
          (t.buildings as string[]).every((b) =>
            a.scopeBuildingIds?.includes(b)
          )
        )
      ) invalid("Исполнитель недоступен для области шаблона");
      const [{ n } = { n: 0 }] = await exec.query<{ n: number }>(
        "select count(distinct r.key)::int n from time_rule r join time_rule_version v on v.rule_id=r.id where r.key in ('task_accept','task_escalation')",
      );
      if (n !== 2) invalid("Настройте регламенты принятия и эскалации задания");
    }
    const [old] = await exec.query<Row>(
      "select * from job_schedule where template_id=$1 for update",
      [id],
    );
    if (Number(input.version ?? 0) !== Number(old?.version ?? 0)) {
      throw new ApiError("CONCURRENT_MODIFICATION");
    }
    const [saved] = await exec.query<Row>(
      `insert into job_schedule(template_id,enabled,next_run_at,interval_hours,due_hours,assignee_person_id,configured_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict(template_id) do update set enabled=excluded.enabled,next_run_at=excluded.next_run_at,interval_hours=excluded.interval_hours,due_hours=excluded.due_hours,assignee_person_id=excluded.assignee_person_id,configured_by=excluded.configured_by,version=job_schedule.version+1,updated_at=now() returning *`,
      [
        id,
        p.enabled,
        p.next,
        p.intervalHours,
        p.dueHours,
        p.assignee,
        actor.person.id,
      ],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "job_schedule.configure",
      "job_template",
      id,
      t.buildings as string[],
      old ?? null,
      saved!,
    );
    return saved!;
  });
}
interface RunPayload {
  actorId: string;
  templateId: string;
  templateVersion: number;
  blueprint: Row;
  buildings: string[];
  isTest: boolean;
  dueAt: string;
  assigneeId: string | null;
}
/** Все пропущенные даты остаются в очереди; ограничение порции не сдвигает их к now(). */
export async function enqueueSchedules(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 30000,
) {
  return deps.db.transaction(async (exec) => {
    const schedules = await exec.query<Row>(
      `select s.*,t.version as template_version,t.blueprint,t.buildings,t.is_test from job_schedule s join job_template t on t.id=s.template_id where s.enabled and t.active and s.next_run_at<=$1 order by s.next_run_at for update of t,s skip locked limit 5`,
      [now],
    );
    let count = 0;
    for (const s of schedules) {
      let at = new Date(String(s.next_run_at));
      for (let i = 0; i < 5 && at <= now && Date.now() < deadline; i++) {
        const payload: RunPayload = {
          actorId: String(s.configured_by),
          templateId: String(s.template_id),
          templateVersion: Number(s.template_version),
          blueprint: jsonValue<Row>(s.blueprint),
          buildings: s.buildings as string[],
          isTest: Boolean(s.is_test),
          dueAt: new Date(at.getTime() + Number(s.due_hours) * 3600000)
            .toISOString(),
          assigneeId: s.assignee_person_id as string | null,
        };
        const [job] = await exec.query<{ id: string }>(
          "insert into job_queue(kind,payload,dedup_key) values ('task.schedule',$1::text::jsonb,$2) on conflict(dedup_key) do update set dedup_key=excluded.dedup_key returning id",
          [
            JSON.stringify(payload),
            `schedule:${s.template_id}:${at.toISOString()}`,
          ],
        );
        await exec.query(
          "insert into job_run(template_id,template_version,scheduled_at,schedule_version,queue_id) values ($1,$2,$3,$4,$5) on conflict(template_id,scheduled_at) do nothing",
          [s.template_id, s.template_version, at, s.version, job!.id],
        );
        at = new Date(at.getTime() + Number(s.interval_hours) * 3600000);
        count++;
      }
      await exec.query(
        "update job_schedule set next_run_at=$2 where template_id=$1",
        [s.template_id, at],
      );
    }
    return count;
  });
}
export async function processScheduledJobs(
  deps: RegistryDeps,
  deadline = Date.now() + 30000,
) {
  let count = 0;
  for (let i = 0; i < 5 && Date.now() < deadline; i++) {
    const found = await deps.db.transaction(async (exec) => {
      const [job] = await exec.query<Row>(
        "select * from job_queue where kind='task.schedule' and state='queued' and run_after<=now() order by id for update skip locked limit 1",
      );
      if (!job) return false;
      await exec.query("savepoint scheduled_job");
      try {
        const p = jsonValue<RunPayload>(job.payload),
          actor = await recipientActor(exec, p.actorId);
        if (
          !actor || actor.person.isTest !== p.isTest ||
          !managesArea(actor, p.buildings, p.isTest)
        ) throw new ApiError("FORBIDDEN");
        const d = {
          ...deps,
          db: {
            ...deps.db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
          },
        };
        const work = await createCommonWork(d, actor, {
          title: p.blueprint.title,
          plan: p.blueprint.instruction,
          due_at: p.dueAt,
          building_ids: p.buildings,
        }, `schedule:${job.id}:work`);
        // Используем зафиксированную методичку; последующая редакция шаблона не меняет повтор запуска.
        const task = await createTask(d, actor, {
          ...p.blueprint,
          common_work_id: work.id,
          due_at: p.dueAt,
          assignee_person_id: p.assigneeId,
        }, `schedule:${job.id}:task`);
        await exec.query(
          "update task set template_id=$2,template_version=$3 where id=$1",
          [task.id, p.templateId, p.templateVersion],
        );
        await exec.query("update job_run set task_id=$2 where queue_id=$1", [
          job.id,
          task.id,
        ]);
        const [row] = await exec.query<TaskRow>(
          `${TASK_SELECT} where t.id=$1`,
          [task.id],
        );
        await informTaskManagers(
          exec,
          row!,
          templateNotice("notices.tasks_schedule_process_scheduled_jobs_101", {detail_a: row!.number}),
          `schedule:${job.id}:created`,
        );
        await exec.query(
          "update job_queue set state='done',attempts=attempts+1,finished_at=now(),last_error=null where id=$1",
          [job.id],
        );
        await exec.query("release savepoint scheduled_job");
      } catch (e) {
        await exec.query("rollback to savepoint scheduled_job");
        const retry = retryPolicy(Number(job.attempts) + 1, {});
        await exec.query(
          "update job_queue set state=$2,attempts=attempts+1,run_after=now()+$3*interval '1 second',last_error=$4 where id=$1",
          [
            job.id,
            retry.failed ? "dead" : "queued",
            retry.delay,
            e instanceof ApiError ? e.code : "JOB_FAILED",
          ],
        );
        await exec.query("release savepoint scheduled_job");
      }
      return true;
    });
    if (!found) break;
    count++;
  }
  return count;
}
export async function retryScheduledJob(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  return deps.db.transaction(async (exec) => {
    const [r] = await exec.query<Row>(
      `select q.id,q.state,q.payload,t.buildings,t.is_test from job_run r join job_queue q on q.id=r.queue_id join job_template t on t.id=r.template_id where r.id=$1 for update of q`,
      [id],
    );
    if (
      !r || !managesArea(actor, r.buildings as string[], Boolean(r.is_test))
    ) throw new ApiError("FORBIDDEN");
    if (r.state !== "dead") throw new ApiError("INVALID_TRANSITION");
    const payload = jsonValue<RunPayload>(r.payload);
    if (!managesArea(actor, payload.buildings, payload.isTest)) {
      throw new ApiError("FORBIDDEN");
    }
    await exec.query(
      "update job_queue set state='queued',attempts=0,run_after=now(),last_error=null,payload=$2::text::jsonb where id=$1",
      [r.id, JSON.stringify({ ...payload, actorId: actor.person.id })],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "job_run.retry",
      "job_run",
      id,
      payload.buildings,
      { state: "dead" },
      { state: "queued" },
    );
    return { state: "queued" };
  });
}
