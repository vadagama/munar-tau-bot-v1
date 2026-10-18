import { t } from "../../templates/store.ts";
import { templateNotice } from "../../templates/notice.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { requireTask } from "../tasks/access.ts";
import { dateInput } from "../tasks/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { startTimer } from "../registry/time.ts";
import { enqueueNotice, recipientActor } from "../notifications/service.ts";
import { responsibleInput } from "./service.ts";
interface Shift extends Row {
  id: string;
  building_id: string;
  primary_person_id: string;
  reserve_person_id: string;
  admin_person_id: string;
  emergency_phone: string;
  is_test: boolean;
}
interface Signal extends Row {
  request_id: string | null;
  task_id: string | null;
  id: string;
  version: number;
  building_id: string;
  is_test: boolean;
  responsible_person_id: string | null;
  stage: string;
  accepted_at: string | null;
  shift_id: string | null;
}
const resource = (actor: Actor, building: string) => ({
  incidentAccess: {
    buildingIds: [building],
    isTest: actor.person.isTest,
    responsibleId: null,
    published: false,
    member: false,
  },
});
export async function saveShift(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, "duty.shift", key, input, async () => {
      const building = content(input.building_id);
      if (!can(actor, "incident.link", resource(actor, building)).allow) {
        throw new ApiError("FORBIDDEN");
      }
      const starts = dateInput(input.starts_at),
        ends = dateInput(input.ends_at);
      if (ends <= starts) invalid("Конец смены должен быть позже начала");
      const primary = await responsibleInput(
          exec,
          actor,
          input.primary_person_id,
          [{ building_id: building }],
        ),
        reserve = await responsibleInput(exec, actor, input.reserve_person_id, [
          { building_id: building },
        ]);
      const admin = await recipientActor(exec, content(input.admin_person_id));
      if (
        !admin || admin.person.isTest !== actor.person.isTest ||
        !can(admin, "incident.link", resource(actor, building)).allow ||
        primary === reserve
      ) invalid("Нужны разные дежурные и администратор области");
      const phone = content(input.emergency_phone);
      if (!/^\+?[\d ()-]{3,30}$/.test(phone)) {
        invalid("Укажите аварийный телефон");
      }
      await exec.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `duty:${actor.person.isTest}:${building}`,
      ]);
      if (
        (await exec.query(
          "select id from duty_shift where building_id=$1 and is_test=$2 and starts_at<$4 and ends_at>$3",
          [building, actor.person.isTest, starts, ends],
        )).length
      ) invalid("Смена пересекается с существующей");
      const [shift] = await exec.query<Shift>(
        "insert into duty_shift(building_id,primary_person_id,reserve_person_id,admin_person_id,starts_at,ends_at,emergency_phone,created_by,is_test) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
        [
          building,
          primary,
          reserve,
          admin.person.id,
          starts,
          ends,
          phone,
          actor.person.id,
          actor.person.isTest,
        ],
      );
      await recordAudit(
        deps,
        exec,
        actor,
        "duty.created",
        "duty_shift",
        shift!.id,
        [building],
        null,
        { starts_at: starts, ends_at: ends },
      );
      return shift!;
    }, async (s) => {
      if (!can(actor, "incident.link", resource(actor, s.building_id)).allow) {
        throw new ApiError("FORBIDDEN");
      }
    })
  );
}
export async function emergencyContact(
  exec: DbExecutor,
  building: string,
  isTest = false,
) {
  const [shift] = await exec.query<Shift & { on_duty: boolean }>(
    "select *,starts_at<=now() and ends_at>now() as on_duty from duty_shift where building_id=$1 and is_test=$2 order by (starts_at<=now() and ends_at>now()) desc,starts_at desc limit 1",
    [building, isTest],
  );
  return {
    phone: shift?.emergency_phone ?? null,
    on_duty: shift?.on_duty ?? false,
    notice: {
      ru: t(undefined,"ru",shift?.on_duty ? "incidents.duty_notice" : "incidents.off_duty_notice"),
      kk: t(undefined,"kk",shift?.on_duty ? "incidents.duty_notice" : "incidents.off_duty_notice"),
    },
  };
}
async function notifySignal(
  exec: DbExecutor,
  s: Signal,
  personId: string,
  key: string,
) {
  await enqueueNotice(exec, {
    personId,
    key,
    type: "incident",
    bot: "worker",
    important: true,
    isTest: s.is_test,
    buildingIds: [s.building_id],
    signalId: s.id,
    text: templateNotice("notices.incidents_duty_notify_signal_101", {s_id: s.id}),
  });
}
export async function signalEmergency(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, "emergency.signal", key, input, async () => {
      let building: string;
      if (input.request_id && !input.task_id) {
        const r = await requireRequest(
          exec,
          actor,
          content(input.request_id),
          "request.comment",
          true,
        );
        if (
          !r.building_id ||
          ["closed", "canceled", "rejected", "draft"].includes(r.state)
        ) invalid("Нужно открытое обращение с объектом");
        building = r.building_id;
      } else if (input.task_id && !input.request_id) {
        const t = await requireTask(
          exec,
          actor,
          content(input.task_id),
          "task.execute",
          true,
        );
        building = content(input.building_id);
        if (!t.building_ids.includes(building)) invalid("Объект вне задания");
      } else invalid("Укажите обращение или задание");
      const [shift] = await exec.query<Shift>(
        "select * from duty_shift where building_id=$1 and is_test=$2 and starts_at<=now() and ends_at>now() order by starts_at desc limit 1",
        [building, actor.person.isTest],
      );
      let responsible: string | null = shift?.primary_person_id ?? null;
      if (responsible) {
        const target = await recipientActor(exec, responsible);
        if (
          !target ||
          !can(target, "incident.manage", {
            incidentAccess: {
              ...resource(actor, building).incidentAccess,
              responsibleId: responsible,
            },
          }).allow
        ) responsible = null;
      }
      const [s] = await exec.query<Signal>(
        "insert into emergency_signal(request_id,task_id,building_id,description,created_by,is_test,shift_id,responsible_person_id,stage) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
        [
          input.request_id ?? null,
          input.task_id ?? null,
          building,
          content(input.description),
          actor.person.id,
          actor.person.isTest,
          shift?.id ?? null,
          responsible,
          responsible ? "primary" : "unassigned",
        ],
      );
      if (responsible) {
        await startTimer(exec, "emergency_primary", s!.id, "emergency:primary");
        await notifySignal(exec, s!, responsible, `signal:${s!.id}:primary`);
      }
      const managers = await exec.query<{ person_id: string }>(
        `select distinct a.person_id from staff_assignment a join person p on p.id=a.person_id where p.is_test=$1 and p.status='active' and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and a.role in ('chairman','administrator','deputy')`,
        [actor.person.isTest],
      );
      for (const m of managers) {
        if (m.person_id !== responsible) {
          await notifySignal(
            exec,
            s!,
            m.person_id,
            `signal:${s!.id}:manager:${m.person_id}`,
          );
        }
      }
      await exec.query(
        "insert into emergency_signal_log(signal_id,action,responsible_person_id,actor_person_id) values($1,'created',$2,$3)",
        [s!.id, responsible, actor.person.id],
      );
      return {
        ...s!,
        contact: await emergencyContact(exec, building, actor.person.isTest),
      };
    }, async (s) => {
      if (s.request_id) await requireRequest(exec, actor, String(s.request_id));
      else await requireTask(exec, actor, String(s.task_id));
    })
  );
}
export async function acceptSignal(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `signal.accept:${id}`, key, input, async () => {
      const [s] = await exec.query<Signal>(
        "select * from emergency_signal where id=$1 for update",
        [id],
      );
      if (!s || s.is_test !== actor.person.isTest) {
        throw new ApiError("NOT_FOUND");
      }
      if (s.responsible_person_id !== actor.person.id) {
        throw new ApiError(
          "CONCURRENT_MODIFICATION",
          "Ответственность уже передана",
          { responsible_person_id: s.responsible_person_id },
        );
      }
      if (
        !can(actor, "incident.manage", {
          incidentAccess: {
            ...resource(actor, s.building_id).incidentAccess,
            responsibleId: actor.person.id,
          },
        }).allow
      ) throw new ApiError("FORBIDDEN");
      checkVersion(s.version, input.expected_version);
      const [updated] = await exec.query<Signal>(
        "update emergency_signal set accepted_at=coalesce(accepted_at,now()),version=version+1 where id=$1 returning *",
        [id],
      );
      await exec.query(
        "update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage like 'emergency:%' and state='pending'",
        [id],
      );
      await exec.query(
        "insert into emergency_signal_log(signal_id,action,responsible_person_id,actor_person_id) values($1,'accepted',$2,$2)",
        [id, actor.person.id],
      );
      return updated!;
    }, async () => {
      const [s] = await exec.query<Signal>(
        "select * from emergency_signal where id=$1",
        [id],
      );
      if (
        !s || s.is_test !== actor.person.isTest ||
        s.responsible_person_id !== actor.person.id ||
        !can(actor, "incident.manage", {
          incidentAccess: {
            ...resource(actor, s.building_id).incidentAccess,
            responsibleId: actor.person.id,
          },
        }).allow
      ) throw new ApiError("FORBIDDEN");
    })
  );
}
export async function listSignals(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<Signal>(
    "select * from emergency_signal where is_test=$1 order by created_at desc limit 200",
    [actor.person.isTest],
  );
  return rows.filter((s) =>
    can(actor, "incident.manage", {
      incidentAccess: {
        ...resource(actor, s.building_id).incidentAccess,
        responsibleId: s.responsible_person_id,
      },
    }).allow
  );
}
export async function listShifts(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<Shift>(
    "select * from duty_shift where is_test=$1 order by starts_at desc limit 200",
    [actor.person.isTest],
  );
  return rows.filter((s) =>
    can(actor, "incident.link", resource(actor, s.building_id)).allow
  );
}
export async function assignSignal(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `signal.assign:${id}`, key, input, async () => {
      const [s] = await exec.query<Signal>(
        "select * from emergency_signal where id=$1 for update",
        [id],
      );
      if (
        !s ||
        !can(actor, "incident.link", {
          incidentAccess: {
            ...resource(actor, String(s.building_id)).incidentAccess,
            isTest: s.is_test,
          },
        }).allow
      ) throw new ApiError("FORBIDDEN");
      checkVersion(s.version, input.expected_version);
      content(input.reason);
      const target = await responsibleInput(
        exec,
        actor,
        input.responsible_person_id,
        [{ building_id: s.building_id }],
      );
      const [updated] = await exec.query<Signal>(
        "update emergency_signal set responsible_person_id=$2,stage='administrator',accepted_at=null,version=version+1 where id=$1 returning *",
        [id, target],
      );
      await exec.query(
        "update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage like 'emergency:%' and state='pending'",
        [id],
      );
      await exec.query(
        "insert into emergency_signal_log(signal_id,action,responsible_person_id,actor_person_id) values($1,'assigned',$2,$3)",
        [id, target, actor.person.id],
      );
      await recordAudit(
        deps,
        exec,
        actor,
        "signal.assigned",
        "emergency_signal",
        id,
        [s.building_id],
        { responsible_person_id: s.responsible_person_id },
        { responsible_person_id: target },
        String(input.reason),
      );
      await notifySignal(
        exec,
        updated!,
        target,
        `signal:${id}:assigned:${updated!.version}`,
      );
      return updated!;
    }, async () => {
      const [s] = await exec.query<Signal>(
        "select * from emergency_signal where id=$1",
        [id],
      );
      if (
        !s || s.is_test !== actor.person.isTest ||
        !can(actor, "incident.link", resource(actor, s.building_id)).allow
      ) throw new ApiError("FORBIDDEN");
    })
  );
}
export async function incidentContext(deps: RegistryDeps, actor: Actor) {
  const scope = actor.globalStaff || actor.assignments.some((a) => a.role === "chairman") ? null : [
    ...new Set(
      actor.assignments.filter((a) =>
        ["administrator", "deputy", "duty"].includes(a.role)
      ).flatMap((a) => a.scopeBuildingIds ?? []),
    ),
  ];
  if (scope?.length === 0) throw new ApiError("FORBIDDEN");
  const persons = await deps.db.query<{ id: string; full_name: string }>(
    `select distinct p.id,p.full_name from person p join staff_assignment a on a.person_id=p.id where p.is_test=$1 and p.status='active' and a.status='active' and a.role in ('chairman','administrator','deputy','duty') and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) order by p.full_name`,
    [actor.person.isTest],
  );
  const buildings = await deps.db.query(
    "select id,code from building where $1::uuid[] is null or id=any($1::uuid[]) order by code",
    [scope],
  );
  const premises = await deps.db.query(
    "select id,building_id,kind,number from premises where is_test=$1 and ($2::uuid[] is null or building_id=any($2::uuid[])) order by building_id,number",
    [actor.person.isTest, scope],
  );
  return { persons, buildings, premises };
}
