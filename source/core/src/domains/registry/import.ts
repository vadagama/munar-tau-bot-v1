import { lockAudience } from "./audience-lock.ts";
import { jsonValue } from "./validation.ts";
import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { requireBuilding, registryScope } from "./access.ts";
import { recordAudit, type RegistryDeps } from "./service.ts";
import {
  normalizePhone,
  text,
  validatePremises,
  type Row,
} from "./validation.ts";
import { SHEETS, type ImportPayload } from "./workbook.ts";
export interface ImportIssue {
  sheet: string;
  row: number;
  field: string;
  value: unknown;
  reason: string;
  hint: string;
}
interface PlannedRow {
  key: string;
  id: string;
  data: Row;
  exists: boolean;
}
export interface ImportReport {
  errors: ImportIssue[];
  plan: Record<keyof ImportPayload, PlannedRow[]>;
  added: number;
  skipped: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES = {
  buildings: "building",
  premises: "premises",
  persons: "person",
  connections: "connection",
} as const;

export async function validateImport(
  exec: DbExecutor,
  actor: Actor,
  payload: ImportPayload,
): Promise<ImportReport> {
  registryScope(actor);
  const report: ImportReport = {
    errors: [],
    plan: { buildings: [], premises: [], persons: [], connections: [] },
    added: 0,
    skipped: 0,
  };
  const maps = {
    buildings: new Map<string, PlannedRow>(),
    premises: new Map<string, PlannedRow>(),
    persons: new Map<string, PlannedRow>(),
    connections: new Map<string, PlannedRow>(),
  };
  const personBuildings = await exec.query<{
    person_id: string;
    building_id: string;
  }>(
    "select c.person_id,p.building_id from connection c join premises p on p.id=c.premises_id",
  );
  for (const entity of Object.keys(SHEETS) as (keyof ImportPayload)[]) {
    const seen = new Set<string>();
    const current = await exec.query<Row>(`select * from ${TABLES[entity]}`);
    for (const [index, original] of payload[entity].entries()) {
      let field = "key";
      try {
        const row = { ...original };
        const key = text(row, "key");
        if (maps[entity].has(key)) throw new Error("Ключ повторяется на листе");
        if (row.id && !UUID.test(String(row.id))) {
          field = "id";
          throw new Error("Некорректный UUID");
        }
        const explicit = row.id
          ? current.find((r) => r.id === row.id)
          : undefined;
        if (row.id && !explicit) {
          field = "id";
          throw new Error(
            "Постоянный ID не найден; новые записи создаются без id",
          );
        }
        let data: Row;
        let natural: Row | undefined;
        switch (entity) {
          case "buildings": {
            field = "code";
            data = {
              code: text(row, "code"),
              name: row.name || null,
            };
            natural = current.find((r) => r.code === data.code);
            if (!explicit && !natural && actor.person.isTest)
              throw new Error(
                "Общая структура зданий не изменяется в эмуляции",
              );
            if (
              !explicit &&
              !natural &&
              !actor.assignments.some((a) => a.role === "chairman")
            )
              throw new Error(
                "Новые здания добавляет председатель; используйте существующий ID",
              );
            if (explicit || natural)
              requireBuilding(actor, String((explicit ?? natural)!.id));
            break;
          }
          case "premises": {
            field = "building_key";
            const building = maps.buildings.get(text(row, "building_key"));
            if (!building)
              throw new Error("Родитель не найден на листе зданий");
            if (building.exists) requireBuilding(actor, building.id);
            data = {
              building_id: building.id,
              kind: row.kind,
              number: row.number,
              entrance: row.entrance ?? null,
              floor: row.floor ?? null,
            };
            field = "number";
            validatePremises(data);
            natural = current.find(
              (r) =>
                r.building_id === data.building_id &&
                r.kind === data.kind &&
                r.number === data.number,
            );
            break;
          }
          case "persons": {
            field = "phone_e164";
            data = {
              full_name: text(row, "full_name"),
              phone_e164: normalizePhone(row.phone_e164),
            };
            const phone = current.find((r) => r.phone_e164 === data.phone_e164);
            if (phone && phone.id !== explicit?.id)
              throw new Error(
                "Номер уже принадлежит карточке; совпадение не объединяет лиц. Укажите проверенный ID либо исправьте номер",
              );
            if (explicit) {
              const scoped = personBuildings.filter(
                (r) => r.person_id === explicit.id,
              );
              if (
                !scoped.length &&
                !actor.assignments.some((a) => a.role === "chairman")
              )
                throw new Error("Карточка вне области доступа");
              for (const b of scoped) requireBuilding(actor, b.building_id);
              if (explicit.is_test !== actor.person.isTest)
                throw new Error("Карточка вне области доступа");
            }
            break;
          }
          case "connections": {
            field = "person_key";
            const person = maps.persons.get(text(row, "person_key"));
            field = "premises_key";
            const premises = maps.premises.get(text(row, "premises_key"));
            if (!person || !premises)
              throw new Error("Ссылка на лицо или помещение не найдена");
            field = "role";
            if (row.role !== "owner")
              throw new Error(
                "Первичная загрузка включает только собственников",
              );
            field = "basis";
            if (row.basis !== "initial_registry")
              throw new Error("Основание первичной загрузки: initial_registry");
            data = {
              person_id: person.id,
              premises_id: premises.id,
              role: "owner",
              basis: "initial_registry",
            };
            natural = current.find(
              (r) =>
                r.person_id === person.id &&
                r.premises_id === premises.id &&
                r.status !== "revoked",
            );
            break;
          }
        }
        const fingerprint =
          entity === "persons"
            ? String(data.phone_e164)
            : entity === "buildings"
              ? JSON.stringify([data.code])
              : entity === "premises"
                ? JSON.stringify([data.building_id, data.kind, data.number])
                : JSON.stringify([data.person_id, data.premises_id]);
        if (seen.has(fingerprint))
          throw new Error("Дублирующаяся запись в файле");
        seen.add(fingerprint);
        const existing = explicit ?? natural;
        if (
          entity === "premises" &&
          existing &&
          existing.is_test !== actor.person.isTest
        )
          throw new Error("Помещение вне области данных");
        if (
          existing &&
          Object.entries(data).some(([k, v]) => (existing[k] ?? null) !== v)
        )
          throw new Error(
            "Расхождение с реестром; измените запись отдельно в кабинете",
          );
        const planned = {
          key,
          id: String(existing?.id ?? crypto.randomUUID()),
          data,
          exists: !!existing,
        };
        maps[entity].set(key, planned);
        report.plan[entity].push(planned);
        if (existing) report.skipped++;
        else report.added++;
      } catch (error) {
        report.errors.push({
          sheet: SHEETS[entity].name,
          row: Number(original._row ?? index + 2),
          field,
          value: original[field] ?? "",
          reason: error instanceof Error ? error.message : "Ошибка",
          hint: "Исправьте строку в шаблоне; существующие сведения меняются через кабинет",
        });
      }
    }
  }
  return report;
}

export async function uploadImport(
  deps: RegistryDeps,
  actor: Actor,
  payload: ImportPayload,
): Promise<Row> {
  registryScope(actor);
  const [batch] = await deps.db.query<Row>(
    "insert into import_batch(created_by,payload) values ($1,$2::text::jsonb) returning id,state",
    [actor.person.id, JSON.stringify(payload)],
  );
  return batch!;
}
export async function inspectImport(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  const [batch] = await deps.db.query<Row>(
    "select * from import_batch where id=$1",
    [id],
  );
  if (!batch || batch.created_by !== actor.person.id)
    throw new ApiError("NOT_FOUND");
  registryScope(actor);
  if (batch.state === "uploaded") {
    const report = await validateImport(
      deps.db,
      actor,
      jsonValue<ImportPayload>(batch.payload),
    );
    await deps.db.query(
      "update import_batch set state=$2,errors=$3::text::jsonb,preview=$4::text::jsonb where id=$1 and state='uploaded'",
      [
        id,
        report.errors.length ? "invalid" : "ready",
        JSON.stringify(report.errors),
        JSON.stringify({ added: report.added, skipped: report.skipped }),
      ],
    );
    return {
      ...batch,
      state: report.errors.length ? "invalid" : "ready",
      errors: report.errors,
      preview: { added: report.added, skipped: report.skipped },
      payload: undefined,
    };
  }
  return {
    ...batch,
    errors: jsonValue(batch.errors),
    preview: jsonValue(batch.preview),
    payload: undefined,
  };
}
export async function commitImport(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  registryScope(actor);
  return deps.db.transaction(async (exec) => {
    await lockAudience(exec);
    const [batch] = await exec.query<Row>(
      "select * from import_batch where id=$1 for update",
      [id],
    );
    if (!batch || batch.created_by !== actor.person.id)
      throw new ApiError("NOT_FOUND");
    if (batch.state === "committed") return { id, state: "committed" };
    if (batch.state !== "ready")
      throw new ApiError(
        "INVALID_TRANSITION",
        "Проверка импорта не завершена или найдены ошибки",
      );
    // Сериализация commit с ручными изменениями; повторная валидация устраняет TOCTOU.
    await exec.query(
      "lock table building,premises,person,connection in share row exclusive mode",
    );
    const report = await validateImport(
      exec,
      actor,
      jsonValue<ImportPayload>(batch.payload),
    );
    if (report.errors.length)
      throw new ApiError(
        "VALIDATION_FAILED",
        "Реестр изменился; исправьте конфликты",
        report.errors,
      );
    const definitions = {
      buildings: "id uuid,code text,name text",
      premises:
        "id uuid,building_id uuid,kind text,number text,entrance integer,floor integer,is_test boolean",
      persons:
        "id uuid,full_name text,phone_e164 text,is_test boolean,data_source text,processing_basis text",
      connections:
        "id uuid,person_id uuid,premises_id uuid,role text,basis text,status text,created_by uuid",
    };
    for (const entity of Object.keys(TABLES) as (keyof ImportPayload)[]) {
      const records = report.plan[entity]
        .filter((row) => !row.exists)
        .map((row) => {
          const data: Row = { id: row.id, ...row.data };
          if (entity === "persons" || entity === "premises")
            data.is_test = actor.person.isTest;
          if (entity === "persons") {
            data.data_source = "initial_excel";
            data.processing_basis = "Исходный реестр ОСИ";
          }
          if (entity === "connections") {
            data.created_by = actor.person.id;
            data.status = "pending";
          }
          return data;
        });
      const columns = definitions[entity]
        .split(",")
        .map((c) => c.trim().split(" ")[0])
        .join(",");
      for (let offset = 0; offset < records.length; offset += 500) {
        await exec.query(
          `insert into ${TABLES[entity]} (${columns}) select ${columns} from jsonb_to_recordset($1::text::jsonb) as x(${definitions[entity]})`,
          [JSON.stringify(records.slice(offset, offset + 500))],
        );
      }
      const mappings = report.plan[entity].map((row) => ({
        source_key: row.key,
        entity_id: row.id,
      }));
      if (mappings.length)
        await exec.query(
          "insert into import_mapping(batch_id,entity_type,source_key,entity_id) select $1,$2,x.source_key,x.entity_id from jsonb_to_recordset($3::text::jsonb) as x(source_key text,entity_id uuid)",
          [id, entity, JSON.stringify(mappings)],
        );
    }
    await exec.query(
      "update import_batch set state='committed',committed_at=now() where id=$1",
      [id],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "registry.import.commit",
      "import_batch",
      id,
      report.plan.buildings.map((r) => r.id),
      null,
      { added: report.added, skipped: report.skipped },
    );
    return {
      id,
      state: "committed",
      added: report.added,
      skipped: report.skipped,
    };
  });
}

/** Ограниченная порция фоновой валидации; блокировка исключает двойную обработку. */
export async function processImportBatches(
  deps: RegistryDeps,
  deadline = Date.now() + 45000,
): Promise<number> {
  const { SqlAdminRepo } = await import("../admin/repo.ts");
  const { buildActorForProfile } = await import("../admin/actor-service.ts");
  return deps.db.transaction(async (exec) => {
    const batches = await exec.query<Row>(
      "select * from import_batch where state='uploaded' order by created_at for update skip locked limit 2",
    );
    let processed = 0;
    for (const batch of batches) {
      if (Date.now() >= deadline) break;
      processed++;
      try {
        const [profileRow] = await exec.query<{ id: string }>(
          "select id from profile where person_id=$1 and archived_at is null",
          [batch.created_by],
        );
        if (!profileRow)
          throw new ApiError("FORBIDDEN", "Профиль создателя недействителен");
        const repo = new SqlAdminRepo();
        const profile = await repo.getProfile(exec, profileRow.id);
        const actor = await buildActorForProfile(
          repo,
          exec,
          profile!,
          new Date(),
        );
        const report = await validateImport(
          exec,
          actor,
          jsonValue<ImportPayload>(batch.payload),
        );
        await exec.query(
          "update import_batch set state=$2,errors=$3::text::jsonb,preview=$4::text::jsonb where id=$1",
          [
            batch.id,
            report.errors.length ? "invalid" : "ready",
            JSON.stringify(report.errors),
            JSON.stringify({ added: report.added, skipped: report.skipped }),
          ],
        );
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await exec.query(
          "update import_batch set state='invalid',errors=$2::text::jsonb where id=$1",
          [
            batch.id,
            JSON.stringify([
              {
                sheet: "",
                row: 0,
                field: "",
                value: "",
                reason: error.message,
                hint: "Повторите загрузку с действующими полномочиями",
              },
            ]),
          ],
        );
      }
    }
    return processed;
  });
}
