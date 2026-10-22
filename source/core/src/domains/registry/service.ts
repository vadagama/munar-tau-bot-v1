import { templateNotice } from "../../templates/notice.ts";
import type { TemplateStore } from "../../templates/store.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import type { AuditRepo } from "../audit/port.ts";
import { buildAuditInput } from "../audit/entry.ts";
import { ApiError } from "../../errors/api.ts";
import { registryScope, requireBuilding } from "./access.ts";
import {
  BASES,
  invalid,
  normalizePhone,
  text,
  validateConnectionRole,
  validateConstructionPhase,
  validatePremises,
  type Row,
} from "./validation.ts";

export interface RegistryDeps {
  bot?: import("../../bot/bots.ts").BotKind;
  workerBotUsername?: string;
  residentBotUsername?: string;
  fileStorage?: import("../requests/files.ts").FileStorage;
  templates?: TemplateStore;
  db: DbClient;
  audit: AuditRepo;
}
export type RegistryEntity =
  | "buildings"
  | "persons"
  | "premises"
  | "connections";
const TABLES = {
  buildings: "building",
  persons: "person",
  premises: "premises",
  connections: "connection",
} as const;

export async function recordAudit(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  action: string,
  entityType: string,
  id: string,
  buildingIds: string[],
  before: unknown,
  after: unknown,
  reason?: string,
): Promise<void> {
  await deps.audit.append(
    exec,
    buildAuditInput(actor, {
      action,
      entityType,
      entityId: id,
      buildingIds,
      before,
      after,
      reason,
    }),
  );
}

export async function getPremises(exec: DbExecutor, id: string): Promise<Row> {
  const [row] = await exec.query<Row>("select * from premises where id=$1", [
    id,
  ]);
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

export async function listRegistry(
  deps: RegistryDeps,
  actor: Actor,
  entity: RegistryEntity,
): Promise<Row[]> {
  const scope = registryScope(actor);
  const params = [scope];
  const filter = "($1::uuid[] is null or b.id=any($1::uuid[]))";
  switch (entity) {
    case "buildings":
      return deps.db.query<Row>(
        `select b.* from building b where ${filter} order by b.code`,
        params,
      );
    case "premises":
      return deps.db.query<Row>(
        `select p.*,b.code as building_code from premises p join building b on b.id=p.building_id where ${filter} and p.is_test=$2 order by b.code,p.kind,p.number`,
        [...params, actor.person.isTest],
      );
    case "connections":
      return deps.db.query<Row>(
        `select c.*,p.building_id,p.kind,p.number,n.full_name from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id join person n on n.id=c.person_id where ${filter} and n.is_test=$2 order by c.created_at desc`,
        [...params, actor.person.isTest],
      );
    case "persons":
      return deps.db.query<Row>(
        `select n.*,
          array(select distinct a.role::text from staff_assignment a where a.person_id=n.id and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())) as staff_roles,
          registration.state as registration_state, registration.created_at as registered_at,
          coalesce((select jsonb_agg(jsonb_build_object(
            'id',p.id,'building_id',b.id,'building_code',b.code,'building_name',b.name,
            'kind',p.kind,'number',p.number,'role',c.role) order by b.code,p.kind,p.number)
            from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id
            where c.person_id=n.id and c.status='active' and p.is_test=$2 and ${filter}), '[]'::jsonb) as linked_premises
        from person n
        left join lateral (
          select r.state,r.created_at from registration r
          where r.person_id=n.id and r.is_test=$2 and r.superseded_by is null
          order by (r.premises_id is null) desc,(r.state<>'withdrawn') desc,r.created_at desc,r.id desc limit 1
        ) registration on true
        where n.is_test=$2 and ($1::uuid[] is null or exists (
          select 1 from connection c join premises p on p.id=c.premises_id
          where c.person_id=n.id and p.building_id=any($1::uuid[])
        )) order by n.full_name`,
        [...params, actor.person.isTest],
      );
  }
}

/** Служебный каталог: та же область registry.read, без зависимости от квартиры. */
export async function listStaff(deps: RegistryDeps, actor: Actor): Promise<Row[]> {
  const scope = registryScope(actor);
  return deps.db.query<Row>(
    `select n.id,n.full_name,n.phone_e164,n.comment,
      array_agg(distinct a.role::text order by a.role::text) as staff_roles
     from person n join staff_assignment a on a.person_id=n.id
     where n.is_test=$2 and a.status='active'
       and (a.valid_from is null or a.valid_from<=now())
       and (a.valid_until is null or a.valid_until>now())
       and ($1::uuid[] is null or exists (
         select 1 from staff_scope s join staff_assignment scoped on scoped.id=s.assignment_id
         where scoped.person_id=n.id and scoped.status='active'
           and (scoped.valid_from is null or scoped.valid_from<=now())
           and (scoped.valid_until is null or scoped.valid_until>now())
           and s.building_id=any($1::uuid[])
       ) or exists (
         select 1 from connection c join premises p on p.id=c.premises_id
         where c.person_id=n.id and p.building_id=any($1::uuid[])
       ))
     group by n.id,n.full_name,n.phone_e164,n.comment order by n.full_name`,
    [scope, actor.person.isTest],
  );
}

export async function mutateRegistry(
  deps: RegistryDeps,
  actor: Actor,
  entity: RegistryEntity,
  input: Row,
  id?: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const table = TABLES[entity];
    const [before] = id
      ? await exec.query<Row>(`select * from ${table} where id=$1 for update`, [
          id,
        ])
      : [];
    if (id && !before) throw new ApiError("NOT_FOUND");
    const data = { ...before, ...input };
    let buildings: string[];
    let columns: string[];
    switch (entity) {
      case "buildings": {
        if (actor.emulation)
          throw new ApiError(
            "FORBIDDEN",
            "Общая структура зданий не изменяется в эмуляции",
          );
        if (!actor.assignments.some((a) => a.role === "chairman"))
          throw new ApiError(
            "FORBIDDEN",
            "Структуру зданий задаёт председатель",
          );
        data.code = text(data, "code");
        validateConstructionPhase(data.construction_phase);
        columns = ["code", "name", "construction_phase"];
        buildings = id ? [id] : [];
        break;
      }
      case "premises": {
        validatePremises(data);
        if (before && before.is_test !== actor.person.isTest)
          throw new ApiError("NOT_FOUND");
        data.is_test = actor.person.isTest;
        if (before) requireBuilding(actor, String(before.building_id));
        requireBuilding(actor, String(data.building_id));
        const [building] = await exec.query<Row>(
          "select * from building where id=$1",
          [data.building_id],
        );
        if (!building) invalid("Здание не найдено");
        if (
          data.status &&
          !["active", "archived"].includes(String(data.status))
        )
          invalid("Состояние помещения");
        buildings = [String(data.building_id)];
        columns = [
          "building_id",
          "kind",
          "number",
          "entrance",
          "floor",
          "status",
          "is_test",
        ];
        data.status ??= "active";
        break;
      }
      case "persons": {
        data.full_name = text(data, "full_name");
        data.phone_e164 = normalizePhone(data.phone_e164);
        if (before) {
          const rows = await exec.query<{ building_id: string }>(
            `select distinct p.building_id from connection c join premises p on p.id=c.premises_id where c.person_id=$1`,
            [id],
          );
          buildings = rows.map((r) => r.building_id);
          if (
            buildings.length === 0 &&
            !actor.assignments.some((a) => a.role === "chairman")
          )
            throw new ApiError("NOT_FOUND");
          for (const b of buildings) requireBuilding(actor, b);
          if (before.is_test !== actor.person.isTest)
            throw new ApiError("NOT_FOUND");
        } else {
          const premises = await getPremises(exec, text(data, "premises_id"));
          requireBuilding(actor, String(premises.building_id));
          if (premises.is_test !== actor.person.isTest)
            throw new ApiError("NOT_FOUND");
          buildings = [String(premises.building_id)];
          text(data, "processing_basis");
          text(data, "source");
        }
        data.is_test = actor.person.isTest;
        data.data_source ??= data.source;
        columns = [
          "full_name",
          "phone_e164",
          "comment",
          "is_test",
          "data_source",
          "processing_basis",
        ];
        break;
      }
      case "connections": {
        if (
          before &&
          ((input.person_id && input.person_id !== before.person_id) ||
            (input.premises_id && input.premises_id !== before.premises_id))
        )
          invalid("Для переноса создайте новую связь");
        const premises = await getPremises(exec, text(data, "premises_id"));
        requireBuilding(actor, String(premises.building_id));
        if (premises.is_test !== actor.person.isTest)
          throw new ApiError("NOT_FOUND");
        validateConnectionRole(String(premises.kind), data.role);
        if (!BASES.includes(data.basis as (typeof BASES)[number]))
          invalid("Укажите основание связи");
        const [person] = await exec.query<Row>(
          "select * from person where id=$1 for update",
          [text(data, "person_id")],
        );
        if (!person || person.status !== "active" || person.is_test !== actor.person.isTest)
          throw new ApiError("NOT_FOUND");
        if (before?.status === "revoked")
          throw new ApiError(
            "INVALID_TRANSITION",
            "Прекращённую связь не изменяют",
          );
        if (
          before?.status === "active" &&
          input.role !== undefined &&
          input.role !== before.role
        )
          throw new ApiError(
            "INVALID_TRANSITION",
            "Для смены роли прекратите прежнюю связь и создайте новую",
          );
        if (before?.status === "active" && input.status === "pending")
          throw new ApiError(
            "INVALID_TRANSITION",
            "Действующую связь прекращают с причиной, а не возвращают в ожидание",
          );
        data.status ??= "pending";
        if (!["pending", "active", "revoked"].includes(String(data.status)))
          invalid("Состояние связи");
        data.confirmed_by = before?.confirmed_by ?? null;
        data.confirmed_at = before?.confirmed_at ?? null;
        if (data.status === "active" && before?.status !== "active") {
          data.confirmed_by = actor.person.id;
          data.confirmed_at = new Date().toISOString();
        }
        if (data.status === "revoked") {
          text(data, "revoked_reason");
          data.end_date = new Date().toISOString().slice(0, 10);
          if (before?.role === "owner") {
            const affected = await revokeOwnerDependents(
              exec,
              String(before.person_id),
              String(before.premises_id),
              String(data.revoked_reason),
            );
            for (const connection of affected) {
              await notifyPerson(
                exec,
                String(connection.person_id),
                templateNotice("notices.registry_service_mutate_registry_1", {}),
                `${connection.id}:owner-change`,
              );
              await recordAudit(
                deps,
                exec,
                actor,
                "connection.owner_change",
                "connection",
                String(connection.id),
                [String(premises.building_id)],
                { status: "active" },
                { status: "revoked" },
                String(data.revoked_reason),
              );
            }
          }
        }
        data.created_by = before?.created_by ?? actor.person.id;
        buildings = [String(premises.building_id)];
        columns = [
          "person_id",
          "premises_id",
          "role",
          "basis",
          "status",
          "start_date",
          "end_date",
          "confirmed_by",
          "confirmed_at",
          "revoked_reason",
          "created_by",
        ];
        break;
      }
    }
    const values = columns.map((c) => data[c] ?? null);
    const marks = columns.map((_, i) => `$${i + 1}`);
    const query = id
      ? `update ${table} set ${columns.map((c, i) => `${c}=$${i + 1}`).join(",")} where id=$${values.length + 1} returning *`
      : `insert into ${table} (${columns.join(",")}) values (${marks.join(",")}) returning *`;
    const [after] = await exec.query<Row>(query, id ? [...values, id] : values);
    if (!after) throw new ApiError("INTERNAL");
    // Предварительный профиль без Telegram; связь не выдаёт доступ (REG-09).
    if (entity === "persons" && !id) {
      const premises = await getPremises(exec, String(data.premises_id));
      const role = data.role ?? "owner";
      validateConnectionRole(String(premises.kind), role);
      await exec.query(
        "insert into connection(person_id,premises_id,role,basis,created_by) values ($1,$2,$3,'initial_registry',$4)",
        [after.id, data.premises_id, role, actor.person.id],
      );
    }
    if (
      entity === "connections" &&
      before?.status !== after.status &&
      after.status === "revoked"
    )
      await notifyPerson(
        exec,
        String(after.person_id),
        templateNotice("notices.registry_service_mutate_registry_2", {after_revoked_reason: after.revoked_reason}),
        `${after.id}:revoked`,
      );
    await recordAudit(
      deps,
      exec,
      actor,
      `registry.${entity}.${id ? "update" : "create"}`,
      table,
      String(after.id),
      buildings,
      before,
      after,
    );
    return after;
  });
}

/** Итог каскадного удаления: что удалилось и сколько обращений отвязано. */
export interface DeleteRegistryResult {
  connections: number;
  invites: number;
  registrations: number;
  requests_detached: number;
}

/**
 * Каскад внутри одного помещения: связи, приглашения и анкеты удаляются
 * (FK обязательны), обращения сохраняются без привязки к помещению
 * (прецедент — миграция remove_parking_buildings).
 */
async function deletePremisesCascade(
  exec: DbExecutor,
  premisesId: string,
): Promise<DeleteRegistryResult> {
  const connections = (await exec.query<Row>("delete from connection where premises_id=$1 returning id", [premisesId])).length;
  const invites = (await exec.query<Row>("delete from invite where premises_id=$1 returning id", [premisesId])).length;
  const registrations = (await exec.query<Row>("delete from registration where premises_id=$1 returning id", [premisesId])).length;
  const requests_detached = (await exec.query<Row>("update request set premises_id=null where premises_id=$1 returning id", [premisesId])).length;
  await exec.query("delete from premises where id=$1", [premisesId]);
  return { connections, invites, registrations, requests_detached };
}

/**
 * Жёсткое удаление записи реестра (здание или помещение). Для помещений —
 * с обычными правами registry.write по области дома и тестовому домену,
 * доступно и в эмуляции; здание — только председатель вне эмуляции, при
 * активных аварийных сигналах запрещено (журнал аварий append-only).
 */
export async function deleteRegistry(
  deps: RegistryDeps,
  actor: Actor,
  entity: RegistryEntity,
  id: string,
): Promise<DeleteRegistryResult> {
  if (entity !== "buildings" && entity !== "premises") {
    throw new ApiError("VALIDATION_FAILED", "Удаление доступно только для зданий и помещений");
  }
  return deps.db.transaction(async (exec) => {
    if (entity === "premises") {
      const [premises] = await exec.query<Row>("select * from premises where id=$1 for update", [id]);
      if (!premises) throw new ApiError("NOT_FOUND");
      if (premises.is_test !== actor.person.isTest) throw new ApiError("NOT_FOUND");
      const buildingId = String(premises.building_id);
      requireBuilding(actor, buildingId);
      const counts = await deletePremisesCascade(exec, id);
      await recordAudit(
        deps,
        exec,
        actor,
        "registry.premises.delete",
        "premises",
        id,
        [buildingId],
        premises,
        { deleted: true, ...counts },
      );
      return counts;
    }
    const [building] = await exec.query<Row>("select * from building where id=$1 for update", [id]);
    if (!building) throw new ApiError("NOT_FOUND");
    if (actor.emulation) {
      throw new ApiError("FORBIDDEN", "Общая структура зданий не изменяется в эмуляции");
    }
    if (!actor.assignments.some((a) => a.role === "chairman")) {
      throw new ApiError("FORBIDDEN", "Структуру зданий задаёт председатель");
    }
    const [signal] = await exec.query<Row>(
      "select 1 from emergency_signal where building_id=$1 limit 1",
      [id],
    );
    if (signal) {
      throw new ApiError(
        "INVALID_TRANSITION",
        "У здания есть аварийные сигналы — удаление запрещено (журнал аварий не удаляется)",
      );
    }
    const totals: DeleteRegistryResult = { connections: 0, invites: 0, registrations: 0, requests_detached: 0 };
    const premises = await exec.query<Row>("select id from premises where building_id=$1", [id]);
    for (const row of premises) {
      const counts = await deletePremisesCascade(exec, String(row.id));
      totals.connections += counts.connections;
      totals.invites += counts.invites;
      totals.registrations += counts.registrations;
      totals.requests_detached += counts.requests_detached;
    }
    totals.requests_detached += (await exec.query<Row>(
      "update request set building_id=null where building_id=$1 returning id",
      [id],
    )).length;
    for (const table of ["duty_shift", "incident_scope", "publication_scope", "staff_scope"]) {
      await exec.query(`delete from ${table} where building_id=$1`, [id]);
    }
    await exec.query("delete from building where id=$1", [id]);
    await recordAudit(
      deps,
      exec,
      actor,
      "registry.buildings.delete",
      "building",
      id,
      [id],
      building,
      { deleted: true, ...totals },
    );
    return totals;
  });
}

export async function revokeOwnerDependents(
  exec: DbExecutor,
  personId: string,
  premisesId: string,
  reason: string,
): Promise<Row[]> {
  const affected = await exec.query<Row>(
    `update connection set status='revoked',revoked_reason=$3,end_date=current_date
    where premises_id=$2 and confirmed_by=$1 and role<>'owner' and status='active' returning *`,
    [personId, premisesId, reason],
  );
  await exec.query(
    "update invite set status='revoked' where premises_id=$2 and created_by=$1 and status='active'",
    [personId, premisesId],
  );
  return affected;
}
