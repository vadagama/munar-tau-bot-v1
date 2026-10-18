// Логика области видимости журнала (AUD-02, план VS-1): председатель — всё;
// администратор — записи своих домов (scope_buildings ⊆ область); техадмин —
// технические события (префикс tech.). Прочие роли журнал не читают — PDP
// (audit.read) их не пускает, здесь дублируем отказ (защита в глубину).

import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";
import type { AuditVisibility } from "./port.ts";

/** Минимум записи, нужный для проверки видимости. */
export interface AuditVisibilityView {
  action: string;
  scopeBuildings: readonly string[];
}

/**
 * Область видимости для актора. Администратор с пустой областью получает
 * видимость без домов — журнал будет пуст (роль допущена, данных не видно).
 */
export function auditVisibilityForActor(actor: Actor): AuditVisibility {
  const isChairman = actor.assignments.some((a) => a.role === "chairman");
  if (isChairman || (actor.globalStaff && actor.assignments.some(a=>a.role==="administrator"))) {
    return { allBuildings: true, technicalActions: false, scopeBuildingIds: [] };
  }

  const scopeBuildingIds = new Set<string>();
  let technicalActions = false;
  let hasQualifyingRole = false;

  for (const assignment of actor.assignments) {
    if (assignment.role === "administrator") {
      hasQualifyingRole = true;
      for (const buildingId of assignment.scopeBuildingIds ?? []) {
        scopeBuildingIds.add(buildingId);
      }
    }
    if (assignment.role === "tech_admin") {
      hasQualifyingRole = true;
      technicalActions = true;
    }
  }

  if (!hasQualifyingRole) {
    throw new ApiError(
      "FORBIDDEN",
      "Журнал доступен председателю, администратору или техадминистратору",
    );
  }

  return { allBuildings: false, technicalActions, scopeBuildingIds: [...scopeBuildingIds] };
}

/**
 * Видима ли запись при заданной области (AUD-02). Записи без тега области
 * (действия по всему ОСИ) видит только председатель; технические — техадмин;
 * записи по домам — администраторы, чья область покрывает тег.
 */
export function isVisibleEntry(
  entry: AuditVisibilityView,
  visibility: AuditVisibility,
): boolean {
  if (visibility.allBuildings) return true;
  if (visibility.technicalActions && entry.action.startsWith("tech.")) return true;
  if (
    visibility.scopeBuildingIds.length > 0 &&
    entry.scopeBuildings.length > 0 &&
    entry.scopeBuildings.every((buildingId) => visibility.scopeBuildingIds.includes(buildingId))
  ) {
    return true;
  }
  return false;
}

/** Курсор страницы: base64(at|id). */
export function encodeAuditCursor(entry: { at: string; id: number }): string {
  return btoa(`${entry.at}|${entry.id}`);
}

/** Разбор курсора. Некорректный курсор — ошибка валидации, не 500. */
export function decodeAuditCursor(cursor: string): { at: string; id: number } {
  let raw: string;
  try {
    raw = atob(cursor);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Некорректный курсор страницы");
  }
  const separator = raw.indexOf("|");
  const at = separator === -1 ? "" : raw.slice(0, separator);
  const id = Number(raw.slice(separator + 1));
  if (at === "" || !Number.isInteger(id) || id < 0) {
    throw new ApiError("VALIDATION_FAILED", "Некорректный курсор страницы");
  }
  return { at, id };
}
