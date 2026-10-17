import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { recipientActor } from "../notifications/service.ts";
import { dateInput } from "../tasks/service.ts";
import {
  incidentResource,
  type IncidentRow,
  incidentScope,
  requireIncident,
} from "./access.ts";
import {
  audienceMember,
  type IncidentScope,
  validateScope,
} from "./audience.ts";
import {
  allowedIncidentActions,
  nextIncidentState,
  requireFullRecovery,
} from "./fsm.ts";
import { queueBroadcast } from "./broadcast.ts";
import { fmtDate } from "../../bot/text.ts";

export async function responsibleInput(
  exec: DbExecutor,
  actor: Actor,
  id: unknown,
  scope: { building_id: string }[],
): Promise<string> {
  if (typeof id !== "string") invalid("Укажите ответственного");
  const target = await recipientActor(exec, id);
  if (
    !target || target.person.isTest !== actor.person.isTest ||
    !can(target, "incident.manage", {
      incidentAccess: {
        buildingIds: [...new Set(scope.map((s) => s.building_id))],
        isTest: actor.person.isTest,
        responsibleId: id,
        published: false,
        member: false,
      },
    }).allow
  ) invalid("Ответственный не имеет действующих полномочий по всему охвату");
  return id;
}
export async function incidentLog(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  row: IncidentRow,
  scope: IncidentScope[],
  from: string | null,
  reason: string,
  meta: Row = {},
) {
  await exec.query(
    "insert into incident_log(incident_id,from_state,to_state,actor_person_id,reason,meta) values($1,$2,$3,$4,$5,$6::text::jsonb)",
    [
      row.id,
      from,
      row.state,
      actor.person.id,
      reason,
      JSON.stringify({
        ...meta,
        version: row.version,
        real_person_id: actor.emulation?.realPersonId ?? actor.person.id,
      }),
    ],
  );
  await recordAudit(
    deps,
    exec,
    actor,
    "incident.changed",
    "incident",
    row.id,
    [...new Set(scope.map((s) => s.building_id))],
    from ? { state: from } : null,
    { state: row.state, version: row.version },
  );
}
export async function broadcastIncident(
  exec: DbExecutor,
  row: IncidentRow,
  scope: IncidentScope[],
) {
  if (!row.public_text) {
    invalid("Укажите публичное обновление без персональных данных");
  }
  const next = row.next_update_at ? `${fmtDate(row.next_update_at)}` : null;
  await queueBroadcast(exec, {
    key: `incident:${row.id}:${row.version}`,
    type: "incident",
    text: {
      ru:
        `🚨 Авария ${row.number}: ${row.title}\n${row.public_text}\nУслуга: ${row.service}\nПрогноз: ${row.forecast}${
          next ? `\nСледующее обновление: ${next}` : ""
        }${
          row.restrictions ? `\nОграничения: ${row.restrictions}` : ""
        }`,
      kk:
        `🚨 Апат ${row.number}: ${row.title}\n${row.public_text}\nҚызмет: ${row.service}\nБолжам: ${row.forecast}${
          next ? `\nКелесі жаңарту: ${next}` : ""
        }${
          row.restrictions ? `\nШектеулер: ${row.restrictions}` : ""
        }`,
    },
    scope,
    isTest: row.is_test,
    incidentId: row.id,
  });
}
export async function createIncident(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      "incidents.create",
      key,
      input,
      async () => {
        const scopes = await validateScope(exec, actor, input.scope);
        const responsible = await responsibleInput(
          exec,
          actor,
          input.responsible_person_id,
          scopes,
        );
        const resource = {
          incidentAccess: {
            buildingIds: scopes.map((s) => s.building_id),
            isTest: actor.person.isTest,
            responsibleId: responsible,
            published: false,
            member: false,
          },
        };
        if (!can(actor, "incident.manage", resource).allow) {
          throw new ApiError("FORBIDDEN");
        }
        const first = dateInput(input.first_signal_at);
        if (!first || new Date(first).getTime() > Date.now()) {
          invalid("Время сигнала не может быть будущим");
        }
        const [row] = await exec.query<IncidentRow>(
          "insert into incident(title,place,service,first_signal_at,responsible_person_id,created_by,is_test) values($1,$2,$3,$4,$5,$6,$7) returning *",
          [
            content(input.title),
            content(input.place),
            content(input.service),
            first,
            responsible,
            actor.person.id,
            actor.person.isTest,
          ],
        );
        for (const s of scopes) {
          await exec.query(
            "insert into incident_scope(incident_id,building_id,zone,service,premises_ids) values($1,$2,$3,$4,$5::uuid[])",
            [row!.id, s.building_id, s.zone, s.service, s.premises_ids],
          );
        }
        await incidentLog(
          deps,
          exec,
          actor,
          row!,
          await incidentScope(exec, row!.id),
          null,
          content(input.reason, "источник сигнала"),
        );
        return row!;
      },
      (response) =>
        requireIncident(exec, actor, response.id, "incident.manage"),
    )
  );
}
export async function listIncidents(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<IncidentRow>(
    "select * from incident where is_test=$1 order by created_at desc limit 200",
    [actor.person.isTest],
  );
  const items: Row[] = [];
  for (const row of rows) {
    const scope = await incidentScope(deps.db, row.id);
    if (
      can(
        actor,
        "incident.read",
        incidentResource(
          row,
          scope,
          await audienceMember(deps.db, actor, scope),
        ),
      ).allow
    ) {
      items.push({
        id: row.id,
        number: row.number,
        title: row.title,
        state: row.state,
        version: row.version,
        public_text: row.public_text,
      });
    }
  }
  return items;
}
export async function getIncident(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const { row, scope } = await requireIncident(deps.db, actor, id);
  const manage =
    can(actor, "incident.manage", incidentResource(row, scope)).allow;
  if (!manage) {
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      state: row.state,
      public_text: row.public_text,
      forecast: row.forecast,
      next_update_at: row.next_update_at,
      scope: scope.map((s) => ({
        building_id: s.building_id,
        zone: s.zone,
        service: s.service,
        recovered_at: s.recovered_at,
      })),
      actions: [],
    };
  }
  return {
    ...row,
    scope,
    actions: allowedIncidentActions(row.state),
    history: await deps.db.query(
      "select * from incident_log where incident_id=$1 order by id",
      [id],
    ),
    requests: await deps.db.query(
      "select request_id from incident_request where incident_id=$1",
      [id],
    ),
  };
}
export async function transitionIncident(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `incidents:${id}`, key, input, async () => {
      const loaded = await requireIncident(
        exec,
        actor,
        id,
        "incident.manage",
        true,
      );
      const row = loaded.row;
      let scope = loaded.scope;
      checkVersion(row.version, input.expected_version);
      const action = content(input.action),
        reason = content(input.reason, "основание");
      const state = action === "update" || action === "warning"
        ? row.state
        : nextIncidentState(row.state, action);
      if (action === "warning" && row.state !== "signal_check") {
        invalid("Предупреждение допустимо во время проверки сигнала");
      }
      if (
        action === "update" &&
        ["completed", "not_confirmed"].includes(row.state)
      ) invalid("Сначала возобновите проверку или устранение");
      const oldScope = [...scope];
      if (input.scope !== undefined) {
        const updatedScope = await validateScope(exec, actor, input.scope);
        const newResource = {
          incidentAccess: {
            ...incidentResource(row, scope).incidentAccess,
            buildingIds: updatedScope.map((s) => s.building_id),
          },
        };
        if (!can(actor, "incident.manage", newResource).allow) {
          throw new ApiError("FORBIDDEN");
        }
        if (!["update", "confirm", "reopen", "recheck"].includes(action)) {
          invalid("Охват меняется отдельным обновлением");
        }
        const linkedRequests = await exec.query<
          { building_id: string; premises_id: string | null }
        >(
          "select r.building_id,r.premises_id from incident_request l join request r on r.id=l.request_id where l.incident_id=$1",
          [id],
        );
        const linkedWorks = await exec.query<{ building_ids: string[] }>(
          "select building_ids from common_work where incident_id=$1",
          [id],
        );
        if (
          linkedRequests.some((r) =>
            !updatedScope.some((s) =>
              s.building_id === r.building_id &&
              (!s.premises_ids.length ||
                (r.premises_id !== null &&
                  s.premises_ids.includes(r.premises_id)))
            )
          ) || linkedWorks.some((w) =>
            w.building_ids.some((b) =>
              !updatedScope.some((s) =>
                s.building_id === b
              )
            )
          )
        ) {
          invalid(
            "Сначала отсоедините обращения и работы вне нового охвата, указав дальнейший маршрут",
          );
        }
        await exec.query(
          "update incident_scope set active=false where incident_id=$1",
          [id],
        );
        for (const s of updatedScope) {
          await exec.query(
            "insert into incident_scope(incident_id,building_id,zone,service,premises_ids) values($1,$2,$3,$4,$5::uuid[]) on conflict(incident_id,building_id,zone,service) do update set active=true,premises_ids=excluded.premises_ids,recovered_at=null,recovery_method=null",
            [id, s.building_id, s.zone, s.service, s.premises_ids],
          );
        }
        scope = await incidentScope(exec, id);
      }
      if (input.recovered_scope_ids !== undefined && action !== "complete") {
        if (
          !Array.isArray(input.recovered_scope_ids) ||
          !input.recovered_scope_ids.length ||
          input.recovered_scope_ids.some((x) =>
            typeof x !== "string" || !scope.some((s) => s.id === x)
          )
        ) invalid("Укажите восстановленные зоны текущего охвата");
        if (
          !["update", "report_recovery"].includes(action) ||
          !["mitigation", "recovery_check"].includes(row.state)
        ) {
          invalid(
            "Частичное восстановление фиксируется при устранении или проверке",
          );
        }
        const actual = dateInput(input.recovery_at);
        if (Date.parse(actual) > Date.now()) {
          invalid("Нужна фактическая дата восстановления");
        }
        await exec.query(
          "update incident_scope set recovered_at=$2,recovery_method=$3 where incident_id=$1 and id=any($4::uuid[]) and active",
          [id, actual, content(input.check_method), input.recovered_scope_ids],
        );
      }
      const forecast = content(input.forecast ?? row.forecast, "прогноз"),
        next = ["completed", "not_confirmed"].includes(state)
          ? null
          : dateInput(input.next_update_at ?? row.next_update_at),
        publicText = (state === "signal_check"
          ? "Сигнал проверяется / Сигнал тексерілуде. "
          : "") + content(input.public_text, "публичное обновление"),
        restrictions = typeof input.restrictions === "string"
          ? input.restrictions
          : row.restrictions;
      if (
        !["completed", "not_confirmed"].includes(state) &&
        (!next || new Date(next).getTime() <= Date.now())
      ) {
        invalid("Укажите будущее время следующего обновления");
      }
      if (action === "start_mitigation") {
        content(input.executor, "исполнитель или внешняя служба");
        if (
          !dateInput(input.started_at) ||
          new Date(String(input.started_at)).getTime() > Date.now()
        ) {
          invalid("Укажите фактическое начало действий");
        }
      }
      if (action === "report_recovery") {
        content(input.recovery_report, "что восстановлено и чем подтверждено");
        content(input.check_method, "способ проверки");
      }
      let recoveryAt: string | null = null;
      if (action === "complete") {
        if (!Array.isArray(input.recovered_scope_ids)) {
          invalid("Укажите проверенные зоны");
        }
        requireFullRecovery(
          scope.map((s) =>
            s.id
          ),
          input.recovered_scope_ids as string[],
        );
        recoveryAt = dateInput(input.recovery_at);
        if (
          !recoveryAt || new Date(recoveryAt).getTime() > Date.now() ||
          input.danger_remains !== false
        ) {
          invalid(
            "Подтвердите отсутствие опасности и фактическое время восстановления",
          );
        }
        const method = content(input.check_method, "способ проверки"),
          report = content(input.final_report, "итоговый отчёт");
        await exec.query(
          "update incident_scope set recovered_at=$2,recovery_method=$3 where incident_id=$1 and active",
          [id, recoveryAt, method],
        );
        input = { ...input, final_report: report };
      }
      if (action === "reopen" || action === "fail_check") {
        await exec.query(
          "update incident_scope set recovered_at=null,recovery_method=null where incident_id=$1 and active",
          [id],
        );
      }
      const [updated] = await exec.query<IncidentRow>(
        `update incident set state=$2,forecast=$3,next_update_at=$4,public_text=$5,restrictions=$6,published=true,version=version+1,
   recovery_at=case when $2='completed' then $7::timestamptz when $8 in ('reopen','fail_check') then null else recovery_at end,
   completed_at=case when $2='completed' then now() when $8='reopen' then null else completed_at end where id=$1 returning *`,
        [
          id,
          state,
          forecast,
          ["completed", "not_confirmed"].includes(state) ? null : next,
          publicText,
          restrictions ?? "",
          recoveryAt,
          action,
        ],
      );
      await incidentLog(deps, exec, actor, updated!, scope, row.state, reason, {
        action,
        previous_completed_at: row.completed_at,
        check_method: input.check_method,
        recovery_report: input.recovery_report,
        executor: input.executor,
        started_at: input.started_at,
        final_report: input.final_report,
      });
      await broadcastIncident(
        exec,
        updated!,
        input.scope !== undefined ? [...oldScope, ...scope] : scope,
      );
      await exec.query(
        "update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage like 'incident:update:%' and state='pending'",
        [id],
      );
      return updated!;
    }, () => requireIncident(exec, actor, id, "incident.manage"))
  );
}
