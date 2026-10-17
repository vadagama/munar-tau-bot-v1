import { TASK_STATE_TEXT } from "../../locales/tasks.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { requireRequest } from "../requests/access.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import { requireTask, taskResource, TASK_SELECT, type TaskRow } from "./access.ts";
import { nextTaskState } from "./fsm.ts";
import type { EvidenceRequirement } from "./report.ts";

export function dateInput(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid("Укажите дату и время с часовым поясом");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) invalid("Укажите часовой пояс");
  return new Date(value).toISOString();
}
export function evidenceInput(value: unknown): EvidenceRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) invalid("Некорректный чек-лист");
  const result = value.map((item: unknown) => {
    if (!item || typeof item !== "object") invalid("Некорректный пункт чек-листа");
    const r = item as Row;
    if (typeof r.required !== "boolean") invalid("Укажите обязательность доказательства");
    return { id: content(r.id), required: r.required };
  });
  if (new Set(result.map(r=>r.id)).size !== result.length) invalid("Пункты чек-листа повторяются");
  return result;
}
async function validateAssignee(exec: DbExecutor, row: TaskRow, id: string) {
  const [person] = await exec.query(`select p.id from person p where p.id=$1 and p.status='active' and p.is_test=$2
    and exists(select 1 from staff_assignment a where a.person_id=p.id and a.role='executor' and a.status='active'
      and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
      and not exists(select 1 from unnest($3::uuid[]) b(id) where not exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=b.id)))`,
    [id,row.is_test,row.building_ids]);
  if (!person || !row.building_ids.length) invalid("Нужен действующий исполнитель в области задания");
}
export async function taskLog(deps: RegistryDeps, exec: DbExecutor, actor: Actor, row: TaskRow,
  action: string, from: string | null, reason: string | null = null, meta: Row = {}) {
  await exec.query(`insert into task_log(task_id,from_state,to_state,actor_person_id,reason,meta)
    values ($1,$2,$3,$4,$5,$6::text::jsonb)`,[row.id,from,row.state,actor.person.id,reason,JSON.stringify({action,version:row.version,...meta,
      real_person_id:actor.emulation?.realPersonId ?? actor.person.id,emulation_session_id:actor.emulation?.sessionId ?? null})]);
  await recordAudit(deps,exec,actor,`task.${action}`,"task",row.id,row.building_ids,from ? {state:from}:null,{state:row.state,version:row.version});
  await exec.query("insert into outbox(event_type,payload,processed_at) values ($1,$2::text::jsonb,now())",
    [`task.${action}`,JSON.stringify({task_id:row.id,version:row.version,is_test:row.is_test})]);
  for (const personId of new Set([row.created_by,row.assignee_person_id,typeof meta.previous_assignee_id === "string" ? meta.previous_assignee_id : null])) {
    if (personId && personId !== actor.person.id) await notifyPerson(exec,personId,
      `Задание ${row.number}: ${TASK_STATE_TEXT[row.state]}. Откройте карточку задания.`, `task:${row.id}:${row.version}:${action}:${personId}`);
  }
}

export async function createTask(deps: RegistryDeps, actor: Actor, input: Row, key: unknown): Promise<TaskRow> {
  return deps.db.transaction(exec => idempotent(exec,actor,"tasks:create",key,input,async () => {
    // Общая работа подключается отдельным сервисом; произвольный FK не даёт права.
    if (input.common_work_id) invalid("Создание общего задания подключается вместе с общей работой");
    const request = await requireRequest(exec,actor,content(input.request_id),"request.manage",true);
    if (CLOSED_STATES.includes(request.state) || request.state === "awaiting_confirmation") invalid("Нельзя добавить задание к завершённому обращению или переданному результату");
    const required = evidenceInput(input.required_evidence);
    const assignee = input.assignee_person_id ? content(input.assignee_person_id) : null;
    if (input.start_conditions != null) invalid("Условия платных услуг подключаются в VS-6");
    for (const name of ["is_required","access_required"]) if (input[name] !== undefined && typeof input[name] !== "boolean") invalid(`Некорректное ${name}`);
    const dependencyId = input.depends_on_task_id ? content(input.depends_on_task_id) : null;
    if (dependencyId) {
      const dependency = await requireTask(exec,actor,dependencyId,"task.manage");
      if (dependency.request_id !== request.id || dependency.state === "canceled") invalid("Предшествующее задание должно относиться к тому же обращению и не быть отменено");
    }
    const [saved] = await exec.query<TaskRow>(`insert into task(request_id,title,instruction,due_at,is_test,created_by,required_evidence,is_required,access_required,depends_on_task_id)
      values ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9,$10) returning *`,[request.id,content(input.title),content(input.instruction),dateInput(input.due_at),actor.person.isTest,actor.person.id,
      JSON.stringify(required),input.is_required !== false,input.access_required === true,dependencyId]);
    let row = {...saved!,building_ids:request.building_id ? [request.building_id] : []};
    if (assignee) {
      await validateAssignee(exec,row,assignee);
      await exec.query("update task set assignee_person_id=$2,state='awaiting_acceptance' where id=$1",[row.id,assignee]);
      row = {...row,assignee_person_id:assignee,state:"awaiting_acceptance"};
    }
    await taskLog(deps,exec,actor,row,assignee ? "assigned" : "created",null);
    return row;
  }, async row => { await requireTask(exec,actor,row.id,"task.manage"); }));
}

export async function getTask(deps: RegistryDeps, actor: Actor, id: string): Promise<Row> {
  return deps.db.transaction(async exec => {
    const row = await requireTask(exec,actor,id);
    return {...row,can_manage:can(actor,"task.manage",taskResource(row)).allow,
      can_execute:can(actor,"task.execute",taskResource(row)).allow,
      log:await exec.query("select * from task_log where task_id=$1 order by id",[id]),
      reports:await exec.query("select * from task_report where task_id=$1 and ($2::boolean or created_by=$3) order by version",[id,can(actor,"task.manage",taskResource(row)).allow,actor.person.id]),
      visits:await exec.query("select * from visit where task_id=$1 order by created_at",[id])};
  });
}
export async function listTasks(deps: RegistryDeps, actor: Actor, input: Row = {}): Promise<TaskRow[]> {
  // SQL-область до LIMIT, PDP повторно проверяет каждую возвращённую строку.
  const scope = [...new Set(actor.assignments.filter(a=>["administrator","deputy"].includes(a.role)).flatMap(a=>a.scopeBuildingIds ?? []))];
  const executorScope = [...new Set(actor.assignments.filter(a=>a.role==="executor").flatMap(a=>a.scopeBuildingIds ?? []))];
  const chairman = actor.assignments.some(a=>a.role==="chairman");
  const rows = await deps.db.query<TaskRow>(`${TASK_SELECT} where t.is_test=$1 and ($2::uuid is null or t.request_id=$2)
    and ($3::boolean or r.building_id=any($4::uuid[]) or (cardinality(w.building_ids)>0 and w.building_ids <@ $4::uuid[])
      or (t.assignee_person_id=$5 and (r.building_id=any($6::uuid[]) or (cardinality(w.building_ids)>0 and w.building_ids <@ $6::uuid[]))))
    order by t.created_at desc,t.id limit 100`,[actor.person.isTest,input.request_id ?? null,chairman,scope,actor.person.id,executorScope]);
  return rows.filter(row=>can(actor,"task.read",taskResource(row)).allow);
}

async function startConditions(exec: DbExecutor, row: TaskRow) {
  if (row.depends_on_task_id) {
    const [dependency] = await exec.query("select state from task where id=$1",[row.depends_on_task_id]);
    if (dependency?.state !== "accepted_admin") invalid("Предшествующее задание ещё не принято");
  }
  if (row.access_required && !(await exec.query("select id from visit where task_id=$1 and status='confirmed' and interval_end>now()",[row.id])).length) invalid("Сначала согласуйте визит с автором или участником");
  if (row.start_conditions != null && Object.keys(jsonValue<Row>(row.start_conditions)).length) invalid("Условия старта платной услуги ещё не проверены");
}
export async function transitionTask(deps: RegistryDeps, actor: Actor, id: string, input: Row, key: unknown): Promise<TaskRow> {
  const action = content(input.action);
  const permission = ["accept","decline","start"].includes(action) ? "task.execute" : "task.manage";
  return deps.db.transaction(exec => idempotent(exec,actor,`tasks:${id}:transition`,key,input,async () => {
    const initial = await requireTask(exec,actor,id,permission);
    // Один порядок блокировок: родитель → задание. Сериализует зависимости.
    if (!initial.request_id) invalid("Общие задания подключаются вместе с общей работой");
    const [parent] = await exec.query("select state from request where id=$1 for update",[initial.request_id]);
    const row = await requireTask(exec,actor,id,permission,true);
    checkVersion(row.version,input.version);
    if (action !== "cancel" && (!parent || CLOSED_STATES.includes(String(parent.state)) || parent.state === "awaiting_confirmation")) invalid("Сначала возобновите обращение или отзовите переданный результат");
    const next = nextTaskState(row.state,action,row.prev_state);
    if (["report","approve","return"].includes(action)) invalid("Отчёт и приёмка подключаются отдельным контуром WRK-16");
    const reason = ["decline","suspend","resume","reassign","cancel"].includes(action) ? content(input.reason,"причину") : null;
    let assignee = row.assignee_person_id;
    let nextAction: string | null = null, nextAt: string | null = null;
    if (action === "assign") {
      assignee = content(input.assignee_person_id);
      await validateAssignee(exec,row,assignee);
    }
    if (action === "start" || action === "resume") await startConditions(exec,row);
    if (action === "suspend") {
      nextAction = content(input.next_action,"следующее действие"); nextAt = dateInput(input.next_action_at);
    }
    if (action === "decline" || action === "reassign") assignee = null;
    if (action === "cancel") {
      if (input.stop_checked !== true) invalid("Подтвердите проверку остановки и влияния на зависимые работы");
      if (row.is_required) invalid("Обязательное задание нельзя отменить без замены или согласованного изменения объёма");
      if ((await exec.query("select id from task where depends_on_task_id=$1 and state not in ('canceled','accepted_admin')",[id])).length) invalid("Сначала разберите зависимые задания");
    }
    await exec.query(`update task set state=$2,assignee_person_id=$3,prev_state=$4,suspend_reason=$5,next_action=$6,next_action_at=$7,
      started_at=case when $8='start' then coalesce(started_at,now()) else started_at end,version=version+1,updated_at=now() where id=$1`,
      [id,next,assignee,action === "suspend" ? row.state : null,action === "suspend" ? reason : null,nextAction,nextAt,action]);
    if (action === "start") await exec.query("update request set work_execution_required=true,work_started_at=coalesce(work_started_at,now()),version=version+1 where id=$1",[row.request_id]);
    const [updated] = await exec.query<TaskRow>(`${TASK_SELECT} where t.id=$1`,[id]);
    await taskLog(deps,exec,actor,updated!,action,row.state,reason,{previous_assignee_id:row.assignee_person_id,assignee_person_id:assignee});
    return updated!;
  },async () => { await requireTask(exec,actor,id,permission); }));
}

export async function taskAssignees(deps: RegistryDeps, actor: Actor, requestId: string) {
  const row = await requireRequest(deps.db,actor,requestId,"request.manage");
  return deps.db.query(`select distinct p.id,p.full_name from person p join staff_assignment a on a.person_id=p.id
    join staff_scope s on s.assignment_id=a.id where p.status='active' and p.is_test=$1 and a.role='executor' and a.status='active'
    and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and s.building_id=$2 order by p.full_name`,[row.is_test,row.building_id]);
}
