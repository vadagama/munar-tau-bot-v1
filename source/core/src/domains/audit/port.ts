// Порт аудита (AUD-01/02, LLD-02 §13, LLD-01 §3.6). Журнал append-only:
// домен только добавляет записи и читает их с фильтром области видимости.
// Реализации: SQL — рядом (repo.ts), in-memory — core/src/testing/memory.ts.

import type { DbExecutor } from "../../db/client.ts";

/** Запись журнала (audit_log, LLD-02 §13). */
export interface AuditEntry {
  id: number;
  at: string;
  /** Реальный актор; null — действие системы. */
  actorPersonId: string | null;
  actorProfileId: string | null;
  /** Эмуляция (AUD-01): сеанс и эмулируемая персона. */
  emulationSessionId: string | null;
  emulatedPersonId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  /** Тег области чтения (AUD-02): дома, к которым относится действие. */
  scopeBuildings: string[];
  meta: Record<string, unknown>;
}

/** Данные новой записи журнала (id и at назначает репозиторий). */
export interface AuditEntryInput {
  actorPersonId: string | null;
  actorProfileId: string | null;
  emulationSessionId: string | null;
  emulatedPersonId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  scopeBuildings: string[];
  meta: Record<string, unknown>;
}

/** Вход сборки записи от имени актора — см. entry.ts (buildAuditInput). */
export interface AuditActionInput {
  action: string;
  entityType: string;
  /** UUID сущности; undefined/null — у singleton-сущностей без UUID. */
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  /** Дома, к которым относится действие; иначе — область назначений актора. */
  buildingIds?: string[];
  meta?: Record<string, unknown>;
}

/**
 * Область видимости журнала (AUD-02): председатель — всё; администратор —
 * записи своих домов; техадмин — технические события (префикс tech.).
 */
export interface AuditVisibility {
  /** Председатель: читать весь журнал без фильтра области. */
  allBuildings: boolean;
  /** Техадмин: технические события (action начинается с tech.). */
  technicalActions: boolean;
  /** Администратор: дома своей области (scope_buildings ⊆ область). */
  scopeBuildingIds: string[];
}

export interface AuditListFilter {
  entityType?: string;
  entityId?: string;
  actorPersonId?: string;
  from?: string;
  to?: string;
  limit: number;
  /** Курсор страницы (encodeAuditCursor); задан — продолжить после него. */
  cursor?: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditRepo {
  append(exec: DbExecutor, input: AuditEntryInput): Promise<AuditEntry>;
  list(exec: DbExecutor, filter: AuditListFilter, visibility: AuditVisibility): Promise<AuditPage>;
}
