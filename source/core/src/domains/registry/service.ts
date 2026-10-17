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
  validatePremises,
  type Row,
} from "./validation.ts";

export interface RegistryDeps {
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
        `select b.*, coalesce((select jsonb_agg(house_id) from building_parking where parking_id=b.id),'[]') as house_ids from building b where ${filter} order by b.code`,
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
        `select distinct n.* from person n left join connection c on c.person_id=n.id left join premises p on p.id=c.premises_id left join building b on b.id=p.building_id where ${filter} and n.is_test=$2 order by n.full_name`,
        [...params, actor.person.isTest],
      );
  }
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
        if (!["house", "parking"].includes(String(data.kind)))
          invalid("Тип здания: house или parking");
        data.code = text(data, "code");
        columns = ["kind", "code", "name"];
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
        if (data.kind === "apartment" && building.kind !== "house")
          invalid("Квартира должна относиться к дому");
        if (data.kind === "parking_slot" && building.kind !== "parking")
          invalid("Парковочное место должно относиться к паркингу");
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
          "select * from person where id=$1",
          [text(data, "person_id")],
        );
        if (!person || person.is_test !== actor.person.isTest)
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
    if (entity === "buildings" && input.house_ids !== undefined) {
      if (!Array.isArray(input.house_ids) || data.kind !== "parking")
        invalid("Связанные дома допустимы у паркинга");
      await exec.query("delete from building_parking where parking_id=$1", [
        after.id,
      ]);
      for (const house of input.house_ids) {
        const [parent] = await exec.query<Row>(
          "select id from building where id=$1 and kind='house'",
          [house],
        );
        if (!parent) invalid("Связь паркинга должна указывать на дом");
        await exec.query(
          "insert into building_parking(parking_id,house_id) values ($1,$2)",
          [after.id, house],
        );
      }
    }
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
