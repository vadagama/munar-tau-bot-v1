import { syncTaskTimers } from "./timing.ts";
import {
  lockCommonParents,
  managesArea,
  requireCommon,
  syncCommonWork,
} from "./common.ts";
import { TASK_STATE_TEXT } from "../../locales/tasks.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { can } from "../../pdp/evaluate.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { requireRequest } from "../requests/access.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import {
  requireTask,
  canAcceptTaskReport,
  TASK_SELECT,
  taskResource,
  type TaskRow,
} from "./access.ts";
import { nextTaskState } from "./fsm.ts";
import {
  type EvidenceRequirement,
  validateEvidenceAcceptance,
} from "./report.ts";

export function dateInput(value: unknown): string {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) invalid("Укажите дату и время с часовым поясом");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) invalid("Укажите часовой пояс");
  return new Date(value).toISOString();
}
export function evidenceInput(value: unknown): EvidenceRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) {
    invalid("Некорректный чек-лист");
  }
  const result = value.map((item: unknown) => {
    if (!item || typeof item !== "object") {
      invalid("Некорректный пункт чек-листа");
    }
    const r = item as Row;
    if (typeof r.required !== "boolean") {
      invalid("Укажите обязательность доказательства");
    }
    if (r.kind !== undefined && r.kind !== "photo" && r.kind !== "file") {
      invalid("Неизвестный вид доказательства");
    }
    return {
      id: content(r.id),
      required: r.required,
      ...(r.kind === "photo" ? { kind: "photo" as const } : {}),
    };
  });
  if (new Set(result.map((r) => r.id)).size !== result.length) {
    invalid("Пункты чек-листа повторяются");
  }
  return result;
}
async function validateAssignee(exec: DbExecutor, row: TaskRow, id: string) {
  const [person] = await exec.query(
    `select p.id from person p where p.id=$1 and p.status='active' and p.is_test=$2
    and exists(select 1 from staff_assignment a where a.person_id=p.id and a.role='executor' and a.status='active'
      and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
      and not exists(select 1 from unnest($3::uuid[]) b(id) where not exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=b.id)))`,
    [id, row.is_test, row.building_ids],
  );
  if (!person || !row.building_ids.length) {
    invalid("Нужен действующий исполнитель в области задания");
  }
}
export async function taskLog(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  row: TaskRow,
  action: string,
  from: string | null,
  reason: string | null = null,
  meta: Row = {},
) {
  await syncTaskTimers(exec,row,from);
  await exec.query(
    `insert into task_log(task_id,from_state,to_state,actor_person_id,reason,meta)
    values ($1,$2,$3,$4,$5,$6::text::jsonb)`,
    [
      row.id,
      from,
      row.state,
      actor.person.id,
      reason,
      JSON.stringify({
        action,
        version: row.version,
        ...meta,
        real_person_id: actor.emulation?.realPersonId ?? actor.person.id,
        emulation_session_id: actor.emulation?.sessionId ?? null,
      }),
    ],
  );
  await recordAudit(
    deps,
    exec,
    actor,
    `task.${action}`,
    "task",
    row.id,
    row.building_ids,
    from ? { state: from } : null,
    { state: row.state, version: row.version },
  );
  await exec.query(
    "insert into outbox(event_type,payload,processed_at) values ($1,$2::text::jsonb,now())",
    [
      `task.${action}`,
      JSON.stringify({
        task_id: row.id,
        version: row.version,
        is_test: row.is_test,
      }),
    ],
  );
  for (
    const personId of new Set([
      row.created_by,
      row.assignee_person_id,
      typeof meta.previous_assignee_id === "string"
        ? meta.previous_assignee_id
        : null,
    ])
  ) {
    if (personId && personId !== actor.person.id) {
      // Личный факт снятия назначения доступен прежнему исполнителю после отзыва task.read.
      // Никаких текущих сведений или ссылки на закрытую карточку в этом сообщении нет.
      if (personId === meta.previous_assignee_id && personId !== row.assignee_person_id) {
        await notifyPerson(exec, personId, {ru:`Ваше назначение на задание ${row.number} снято.`,kk:`${row.number} тапсырмасына тағайындауыңыз алынып тасталды.`},
          `task:${row.id}:${row.version}:unassigned:${personId}`,
          { audience: "personal", isTest: row.is_test });
        continue;
      }
      await notifyPerson(
        exec,
        personId,
        `Задание ${row.number}: ${(action === "request_pause"
          ? "исполнитель запросил остановку: " + reason
          : action === "found_problem"
          ? "исполнитель сообщил о найденной проблеме"
          : TASK_STATE_TEXT[row.state])}. Откройте карточку задания.`,
        `task:${row.id}:${row.version}:${action}:${personId}`,
        {taskId:row.id,buildingIds:row.building_ids,isTest:row.is_test,audience:personId===row.assignee_person_id ? "personal" : "staff",type:row.state==="awaiting_acceptance" ? "task.assignment" : "personal",important:row.state==="awaiting_acceptance"},
      );
    }
  }
}

export async function createTask(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
): Promise<TaskRow> {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, "tasks:create", key, input, async () => {
      if (!!input.request_id === !!input.common_work_id) {
        invalid("Укажите обращение или общую работу");
      }
      const request = input.request_id
        ? await requireRequest(
          exec,
          actor,
          content(input.request_id),
          "request.manage",
          true,
        )
        : null;
      const work = input.common_work_id
        ? await requireCommon(exec, actor, content(input.common_work_id), true)
        : null;
      if (work) await lockCommonParents(exec, work.id);
      if (
        (request &&
          (CLOSED_STATES.includes(request.state) ||
            request.state === "awaiting_confirmation")) ||
        (work && ["completed", "canceled"].includes(work.state))
      ) {
        invalid(
          "Нельзя добавить задание к завершённому или переданному результату",
        );
      }
      if (work && input.access_required === true) {
        invalid("Доступ к помещению оформляется локальным заданием обращения");
      }
      let definition = input;
      let templateId: string | null = null,
        templateVersion: number | null = null;
      if (input.template_id) {
        const [template] = await exec.query<Row>(
          "select * from job_template where id=$1 for share",
          [content(input.template_id)],
        );
        if (
          !template ||
          !managesArea(
            actor,
            template.buildings as string[],
            Boolean(template.is_test),
          )
        ) throw new ApiError("FORBIDDEN");
        checkVersion(Number(template.version), input.template_version);
        const buildings = work?.building_ids ??
          (request?.building_id ? [request.building_id] : []);
        if (
          !template.active || !buildings.length ||
          buildings.some((id) => !(template.buildings as string[]).includes(id))
        ) invalid("Шаблон недоступен для объекта задания");
        definition = jsonValue<Row>(template.blueprint);
        templateId = String(template.id);
        templateVersion = Number(template.version);
      }
      const required = evidenceInput(definition.required_evidence);
      const assignee = input.assignee_person_id
        ? content(input.assignee_person_id)
        : null;
      if (input.start_conditions != null) {
        invalid("Условия платных услуг подключаются в VS-6");
      }
      for (
        const name of ["is_required", "access_required", "document_required"]
      ) {
        if (input[name] !== undefined && typeof input[name] !== "boolean") {
          invalid(`Некорректное ${name}`);
        }
      }
      if (input.document_required === true && input.is_required === false) {
        invalid("Задание с обязательным актом входит в необходимый объём");
      }
      const dependencyId = input.depends_on_task_id
        ? content(input.depends_on_task_id)
        : null;
      if (dependencyId) {
        const dependency = await requireTask(
          exec,
          actor,
          dependencyId,
          "task.manage",
        );
        if (
          dependency.request_id !== (request?.id ?? null) ||
          dependency.common_work_id !== (work?.id ?? null) ||
          dependency.state === "canceled"
        ) {
          invalid(
            "Предшествующее задание должно относиться к тому же обращению и не быть отменено",
          );
        }
      }
      const [saved] = await exec.query<TaskRow>(
        `insert into task(request_id,title,instruction,due_at,is_test,created_by,required_evidence,is_required,access_required,depends_on_task_id,common_work_id,template_id,template_version,document_required)
      values ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [
          request?.id ?? null,
          content(definition.title),
          content(definition.instruction),
          dateInput(input.due_at),
          actor.person.isTest,
          actor.person.id,
          JSON.stringify(required),
          input.is_required !== false,
          input.access_required === true,
          dependencyId,
          work?.id ?? null,
          templateId,
          templateVersion,
          input.document_required === true,
        ],
      );
      let row = {
        ...saved!,
        building_ids: work?.building_ids ??
          (request?.building_id ? [request.building_id] : []),
      };
      if (assignee) {
        await validateAssignee(exec, row, assignee);
        await exec.query(
          "update task set assignee_person_id=$2,state='awaiting_acceptance' where id=$1",
          [row.id, assignee],
        );
        row = {
          ...row,
          assignee_person_id: assignee,
          state: "awaiting_acceptance",
        };
      }
      await taskLog(
        deps,
        exec,
        actor,
        row,
        assignee ? "assigned" : "created",
        null,
      );
      if (work) await syncCommonWork(deps, exec, actor, work.id);
      return row;
    }, async (row) => {
      await requireTask(exec, actor, row.id, "task.manage");
    })
  );
}

export async function getTask(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireTask(exec, actor, id);
    const reports = await exec.query(
      "select * from task_report where task_id=$1 and ($2::boolean or created_by=$3) order by version",
      [id,can(actor,"task.manage",taskResource(row)).allow,actor.person.id],
    );
    return {
      ...row,
      methodology: row.template_id
        ? (await exec.query(
          "select v.version,v.created_at,p.full_name as author_name from job_template_version v join person p on p.id=v.created_by where v.template_id=$1 and v.version=$2",
          [row.template_id, row.template_version],
        ))[0]
        : null,
      ...(can(actor, "task.manage", taskResource(row)).allow ? { delivery_failures: await exec.query(
        "select n.id,n.last_error,f.state as followup_state from notification n left join notification_followup f on f.notification_id=n.id where n.task_id=$1 and n.state='failed' and n.is_test=$2 order by n.created_at desc limit 50", [id,actor.person.isTest],
      ) } : {}),
      can_manage: can(actor, "task.manage", taskResource(row)).allow,
      can_execute: can(actor, "task.execute", taskResource(row)).allow,
      log: await exec.query(
        "select * from task_log where task_id=$1 order by id",
        [id],
      ),
      reports,
      can_approve: canAcceptTaskReport(actor,row,reports.at(-1)?.created_by),
      pending_files: await exec.query(
        "select id,filename,size_bytes,status from attachment where task_id=$1 and uploaded_by=$2 and task_report_id is null order by created_at",
        [id, actor.person.id],
      ),
      visits: await exec.query(
        "select * from visit where task_id=$1 order by created_at",
        [id],
      ),
    };
  });
}
export async function listTasks(
  deps: RegistryDeps,
  actor: Actor,
  input: Row = {},
): Promise<TaskRow[]> {
  // SQL-область до LIMIT, PDP повторно проверяет каждую возвращённую строку.
  const scope = [
    ...new Set(
      actor.assignments.filter((a) =>
        ["administrator", "deputy"].includes(a.role)
      ).flatMap((a) => a.scopeBuildingIds ?? []),
    ),
  ];
  const executorScope = [
    ...new Set(
      actor.assignments.filter((a) => a.role === "executor").flatMap((a) =>
        a.scopeBuildingIds ?? []
      ),
    ),
  ];
  const chairman = actor.assignments.some((a) => a.role === "chairman");
  const rows = await deps.db.query<TaskRow>(
    `${TASK_SELECT} where t.is_test=$1 and ($2::uuid is null or t.request_id=$2)
    and ($3::boolean or r.building_id=any($4::uuid[]) or (cardinality(w.building_ids)>0 and w.building_ids <@ $4::uuid[])
      or (t.assignee_person_id=$5 and (r.building_id=any($6::uuid[]) or (cardinality(w.building_ids)>0 and w.building_ids <@ $6::uuid[]))))
    order by t.created_at desc,t.id limit 100`,
    [
      actor.person.isTest,
      input.request_id ?? null,
      chairman,
      scope,
      actor.person.id,
      executorScope,
    ],
  );
  return rows.filter((row) => can(actor, "task.read", taskResource(row)).allow);
}

async function startConditions(exec: DbExecutor, row: TaskRow) {
  if (row.depends_on_task_id) {
    const [dependency] = await exec.query(
      "select state from task where id=$1",
      [row.depends_on_task_id],
    );
    if (dependency?.state !== "accepted_admin") {
      invalid("Предшествующее задание ещё не принято");
    }
  }
  if (
    row.access_required &&
    !(await exec.query(
      "select id from visit where task_id=$1 and status='confirmed' and interval_end>now()",
      [row.id],
    )).length
  ) invalid("Сначала согласуйте визит с автором или участником");
  if (
    row.start_conditions != null &&
    Object.keys(jsonValue<Row>(row.start_conditions)).length
  ) invalid("Условия старта платной услуги ещё не проверены");
}
export async function transitionTask(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
): Promise<TaskRow> {
  const action = content(input.action);
  const permission =
    ["accept", "decline", "start", "request_pause"].includes(action)
      ? "task.execute"
      : "task.manage";
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `tasks:${id}:transition`, key, input, async () => {
      const initial = await requireTask(exec, actor, id, permission);
      // Один порядок блокировок: родитель → задание. Сериализует зависимости.
      const parent = initial.common_work_id
        ? await lockCommonParents(exec, initial.common_work_id)
        : (await exec.query(
          "select state from request where id=$1 for update",
          [initial.request_id],
        ))[0];
      const row = await requireTask(exec, actor, id, permission, true);
      checkVersion(row.version, input.version);
      if (
        action !== "cancel" &&
        (!parent ||
          (initial.request_id
            ? CLOSED_STATES.includes(String(parent.state)) ||
              parent.state === "awaiting_confirmation"
            : parent.state === "canceled" ||
              (parent.state === "completed" && action !== "return")))
      ) {
        invalid(
          "Сначала возобновите обращение или отзовите переданный результат",
        );
      }
      if (action === "request_pause") {
        if (!["accepted", "in_progress"].includes(row.state)) {
          invalid("Остановка запрашивается после принятия задания");
        }
        const reason = content(input.reason, "причину остановки");
        await exec.query(
          "update task set version=version+1,updated_at=now() where id=$1",
          [id],
        );
        const updated = { ...row, version: row.version + 1 };
        await taskLog(deps, exec, actor, updated, action, row.state, reason);
        return updated;
      }
      if (row.common_work_id && action === "return") {
        const pending = await exec.query(
          "select r.id from common_work_request l join request r on r.id=l.request_id where l.common_work_id=$1 and r.state='awaiting_confirmation' limit 1",
          [row.common_work_id],
        );
        if (pending.length) {
          invalid("Сначала отзовите переданные результаты связанных обращений");
        }
      }
      if (action === "revise_template" && row.state === "on_review") {
        invalid("Сначала верните отчёт на доработку");
      }
      if (
        action === "replace_canceled" &&
        (row.state !== "canceled" || !row.is_required)
      ) invalid("Заменить можно отменённое обязательное задание");
      const next = action === "replace_canceled" ? row.state : nextTaskState(
        row.state,
        action === "revise_template" ? "reassign" : action,
        row.prev_state,
      );
      if (action === "report") invalid("Отправьте отчёт через /reports");
      let reviewMeta: Row = {};
      if (action === "approve" || action === "return") {
        const [report] = await exec.query(
          "select * from task_report where task_id=$1 order by version desc limit 1",
          [id],
        );
        if (!report) invalid("Отчёт отсутствует");
        checkVersion(Number(report.version), input.report_version);
        if (action === "approve") {
          if (!canAcceptTaskReport(actor,row,report.created_by)) throw new ApiError("FORBIDDEN", "Собственную работу должен принять другой администратор");
          if (row.document_required) {
            invalid(
              "Для приёмки нужен обязательный акт; контур документов ещё не подключён",
            );
          }
          if (input.result_checked !== true) {
            invalid("Подтвердите проверку результата и чек-листа");
          }
          const decisions = input.evidence_decisions ?? [];
          if (!Array.isArray(decisions)) {
            invalid("Некорректные решения по доказательствам");
          }
          const normalized = decisions.map((d: unknown) => {
            if (!d || typeof d !== "object") invalid("Некорректное решение");
            return {
              requirementId: content((d as Row).requirement_id),
              reason: content((d as Row).reason),
            };
          });
          validateEvidenceAcceptance(
            jsonValue<string[]>(report.missing_evidence),
            normalized,
          );
          reviewMeta = {
            report_id: report.id,
            report_version: report.version,
            evidence_decisions: normalized,
          };
        } else {
          content(input.expected_result, "ожидаемый результат исправления");
          dateInput(input.rework_due_at);
          if (row.state === "accepted_admin") {
            content(
              input.dependency_review,
              "разбор влияния на зависимые задания",
            );
          }
          reviewMeta = {
            report_id: report.id,
            report_version: report.version,
            expected_result: input.expected_result,
            rework_due_at: input.rework_due_at,
            dependency_review: input.dependency_review ?? null,
          };
        }
      }
      const reason = [
          "decline",
          "suspend",
          "resume",
          "reassign",
          "cancel",
          "replace_canceled",
          "return",
          "revise_template",
        ]
          .includes(action)
        ? content(input.reason, "причину")
        : null;
      let assignee = row.assignee_person_id;
      let nextAction: string | null = null, nextAt: string | null = null;
      if (action === "assign") {
        assignee = content(input.assignee_person_id);
        await validateAssignee(exec, row, assignee);
      }
      if (action === "start" || action === "resume") {
        await startConditions(exec, row);
      }
      if (action === "suspend") {
        nextAction = content(input.next_action, "следующее действие");
        nextAt = dateInput(input.next_action_at);
      }
      if (["decline", "reassign", "revise_template"].includes(action)) {
        assignee = null;
      }
      if (action === "revise_template") {
        const [template] = await exec.query<Row>(
          "select * from job_template where id=$1 for share",
          [content(input.template_id)],
        );
        if (
          !template ||
          !managesArea(
            actor,
            template.buildings as string[],
            Boolean(template.is_test),
          )
        ) throw new ApiError("FORBIDDEN");
        checkVersion(Number(template.version), input.template_version);
        if (
          !template.active ||
          row.building_ids.some((id) =>
            !(template.buildings as string[]).includes(id)
          )
        ) invalid("Шаблон недоступен для объекта задания");
        if (
          row.template_id === template.id &&
          row.template_version === template.version
        ) invalid("Эта версия уже применена");
        const definition = jsonValue<Row>(template.blueprint);
        await exec.query(
          "update task set title=$2,instruction=$3,required_evidence=$4::text::jsonb,template_id=$5,template_version=$6 where id=$1",
          [
            id,
            content(definition.title),
            content(definition.instruction),
            JSON.stringify(evidenceInput(definition.required_evidence)),
            template.id,
            template.version,
          ],
        );
        reviewMeta = {
          previous_template_id: row.template_id ?? null,
          previous_template_version: row.template_version ?? null,
          template_id: template.id,
          template_version: template.version,
          previous_instruction: row.instruction,
          previous_required_evidence: row.required_evidence,
        };
      }
      if (["cancel", "replace_canceled"].includes(action)) {
        if (input.stop_checked !== true) {
          invalid(
            "Подтвердите проверку остановки и влияния на зависимые работы",
          );
        }
        if (row.is_required) {
          const replacement = await requireTask(
            exec,
            actor,
            content(input.replacement_task_id, "заменяющее задание"),
            "task.manage",
            true,
          );
          if (
            replacement.id === id ||
            replacement.request_id !== row.request_id ||
            replacement.common_work_id !== row.common_work_id ||
            !replacement.is_required || replacement.state === "canceled"
          ) invalid("Нужна обязательная замена в том же объёме работ");
          const cycle = await exec.query(
            `with recursive chain as (
            select id,depends_on_task_id from task where id=$1
            union select t.id,t.depends_on_task_id from task t join chain c on t.id=c.depends_on_task_id
          ) select id from chain where id=$2`,
            [replacement.id, id],
          );
          if (cycle.length) {
            invalid("Замена не может зависеть от отменяемого задания");
          }
          const dependents = await exec.query<TaskRow>(
            `${TASK_SELECT} where t.depends_on_task_id=$1`,
            [id],
          );
          if (dependents.some((t) => !!t.started_at)) {
            content(input.dependency_review, "разбор начатых зависимых работ");
          }
          for (
            const dependent of dependents.filter((t) =>
              !t.started_at && t.state !== "canceled"
            )
          ) {
            await exec.query(
              "update task set depends_on_task_id=$2,version=version+1 where id=$1",
              [dependent.id, replacement.id],
            );
            await taskLog(
              deps,
              exec,
              actor,
              { ...dependent, version: dependent.version + 1 },
              "dependency_replaced",
              dependent.state,
              reason,
              {
                previous_dependency_id: id,
                depends_on_task_id: replacement.id,
              },
            );
          }
          reviewMeta = {
            replacement_task_id: replacement.id,
            was_required: true,
            dependency_review: input.dependency_review ?? null,
          };
        } else if (
          (await exec.query(
            "select id from task where depends_on_task_id=$1 and state not in ('canceled','accepted_admin')",
            [id],
          )).length
        ) invalid("Сначала разберите зависимые задания");
      }
      await exec.query(
        `update task set state=$2,assignee_person_id=$3,prev_state=$4,suspend_reason=$5,next_action=$6,next_action_at=$7,
      rework_due_at=case when $8='return' then $9::timestamptz else rework_due_at end,is_required=case when $8 in ('cancel','replace_canceled') and $10::boolean then false else is_required end,started_at=case when $8='start' then coalesce(started_at,now()) else started_at end,version=version+1,updated_at=now() where id=$1`,
        [
          id,
          next,
          assignee,
          action === "suspend" ? row.state : null,
          action === "suspend" ? reason : null,
          nextAction,
          nextAt,
          action,
          action === "return" ? dateInput(input.rework_due_at) : null,
          !!reviewMeta.replacement_task_id,
        ],
      );
      if (action === "start" && row.request_id) {
        await exec.query(
          "update request set work_execution_required=true,work_started_at=coalesce(work_started_at,now()),version=version+1 where id=$1",
          [row.request_id],
        );
      }
      const [updated] = await exec.query<TaskRow>(
        `${TASK_SELECT} where t.id=$1`,
        [id],
      );
      await taskLog(deps, exec, actor, updated!, action, row.state, reason, {
        previous_assignee_id: row.assignee_person_id,
        assignee_person_id: assignee,
        ...reviewMeta,
      });
      if (row.common_work_id) {
        await syncCommonWork(deps, exec, actor, row.common_work_id);
      }
      return updated!;
    }, async () => {
      await requireTask(exec, actor, id, permission);
    })
  );
}

export async function taskAssignees(
  deps: RegistryDeps,
  actor: Actor,
  requestId: string,
) {
  const row = await requireRequest(deps.db, actor, requestId, "request.manage");
  return deps.db.query(
    `select distinct p.id,p.full_name from person p join staff_assignment a on a.person_id=p.id
    join staff_scope s on s.assignment_id=a.id where p.status='active' and p.is_test=$1 and a.role='executor' and a.status='active'
    and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and s.building_id=$2 order by p.full_name`,
    [row.is_test, row.building_id],
  );
}
