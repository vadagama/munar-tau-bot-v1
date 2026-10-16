// SQL-реализация порта аудита (audit_log, LLD-02 §13). Append-only защищает
// миграция 0003 (REVOKE + триггер); репозиторий выполняет только insert/select.
// Видимость AUD-02 фильтруется в SQL — те же правила, что isVisibleEntry.

import type { DbExecutor } from "../../db/client.ts";
import { decodeAuditCursor, encodeAuditCursor } from "./logic.ts";
import type {
  AuditEntry,
  AuditEntryInput,
  AuditListFilter,
  AuditPage,
  AuditRepo,
  AuditVisibility,
} from "./port.ts";

interface AuditRow {
  id: string | number;
  at: Date | string;
  actor_person_id: string | null;
  actor_profile_id: string | null;
  emulation_session_id: string | null;
  emulated_person_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  scope_buildings: unknown;
  meta: unknown;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asArray(value: unknown): string[] {
  const parsed = jsonbValue(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = jsonbValue(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * postgres.js в режиме prepare:false не получает типы колонок для
 * INSERT..RETURNING и может вернуть jsonb строкой, а не разобранным значением
 * (поведение зависит от окружения: прямой Postgres против пулера Supabase).
 */
function jsonbValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function jsonParam(value: unknown): string | null {
  return value === undefined ? null : (JSON.stringify(value) ?? null);
}

function mapEntry(row: AuditRow): AuditEntry {
  return {
    id: typeof row.id === "number" ? row.id : Number(row.id),
    at: toIso(row.at),
    actorPersonId: row.actor_person_id,
    actorProfileId: row.actor_profile_id,
    emulationSessionId: row.emulation_session_id,
    emulatedPersonId: row.emulated_person_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: row.before,
    after: row.after,
    reason: row.reason,
    scopeBuildings: asArray(row.scope_buildings),
    meta: asRecord(row.meta),
  };
}

export class SqlAuditRepo implements AuditRepo {
  public async append(exec: DbExecutor, input: AuditEntryInput): Promise<AuditEntry> {
    const rows = await exec.query<AuditRow>(
      `insert into audit_log
         (actor_person_id, actor_profile_id, emulation_session_id, emulated_person_id,
          action, entity_type, entity_id, before, after, reason, scope_buildings, meta)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12::jsonb)
       returning id, at, actor_person_id, actor_profile_id, emulation_session_id,
         emulated_person_id, action, entity_type, entity_id, before, after, reason,
         scope_buildings, meta`,
      [
        input.actorPersonId,
        input.actorProfileId,
        input.emulationSessionId,
        input.emulatedPersonId,
        input.action,
        input.entityType,
        input.entityId,
        jsonParam(input.before),
        jsonParam(input.after),
        input.reason,
        JSON.stringify(input.scopeBuildings),
        JSON.stringify(input.meta),
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("audit_log: вставка не вернула запись");
    return mapEntry(row);
  }

  public async list(
    exec: DbExecutor,
    filter: AuditListFilter,
    visibility: AuditVisibility,
  ): Promise<AuditPage> {
    const params: unknown[] = [];
    const where: string[] = [];

    // Область видимости (AUD-02) — те же правила, что isVisibleEntry:
    // председатель — всё; иначе технические события либо записи по своим домам.
    if (!visibility.allBuildings) {
      const alternatives: string[] = [];
      if (visibility.technicalActions) {
        alternatives.push("a.action like 'tech.%'");
      }
      if (visibility.scopeBuildingIds.length > 0) {
        params.push(JSON.stringify(visibility.scopeBuildingIds));
        alternatives.push(
          `(a.scope_buildings <> '[]'::jsonb and a.scope_buildings <@ $${params.length}::jsonb)`,
        );
      }
      where.push(alternatives.length > 0 ? `(${alternatives.join(" or ")})` : "false");
    }

    if (filter.entityType !== undefined) {
      params.push(filter.entityType);
      where.push(`a.entity_type = $${params.length}`);
    }
    if (filter.entityId !== undefined) {
      params.push(filter.entityId);
      where.push(`a.entity_id = $${params.length}`);
    }
    if (filter.actorPersonId !== undefined) {
      params.push(filter.actorPersonId);
      where.push(`a.actor_person_id = $${params.length}`);
    }
    if (filter.from !== undefined) {
      params.push(filter.from);
      where.push(`a.at >= $${params.length}::timestamptz`);
    }
    if (filter.to !== undefined) {
      params.push(filter.to);
      where.push(`a.at <= $${params.length}::timestamptz`);
    }
    if (filter.cursor !== undefined) {
      // Точность курсора — миллисекунды: записи в одну микросекунду крайне
      // маловероятны; для скелета VS-1 принимается.
      const cursor = decodeAuditCursor(filter.cursor);
      params.push(cursor.at);
      where.push(
        `(a.at < $${params.length}::timestamptz or ` +
          `(a.at = $${params.length}::timestamptz and a.id < $${params.length + 1}))`,
      );
      params.push(cursor.id);
    }

    params.push(filter.limit + 1);
    const limitParam = params.length;

    const rows = await exec.query<AuditRow>(
      `select a.id, a.at, a.actor_person_id, a.actor_profile_id, a.emulation_session_id,
              a.emulated_person_id, a.action, a.entity_type, a.entity_id, a.before, a.after,
              a.reason, a.scope_buildings, a.meta
       from audit_log a
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       order by a.at desc, a.id desc
       limit $${limitParam}`,
      params,
    );

    const hasMore = rows.length > filter.limit;
    const entries = rows.slice(0, filter.limit).map(mapEntry);
    const last = entries[entries.length - 1];
    return {
      entries,
      nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
    };
  }
}
