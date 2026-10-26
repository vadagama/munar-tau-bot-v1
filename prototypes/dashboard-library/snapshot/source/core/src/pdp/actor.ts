// Сборка Actor из строк БД (LLD-01 §3.1: сборка — репозиторием, оценка — can()).
// Здесь проверяются отзыв и срок полномочий (ROL-03, ROL-04): в Actor попадают
// только действующие назначения на момент now. Дефолт-константы AUTH-06 — здесь,
// чтобы политика сеансов и сборка использовали одни значения.

import type { Actor, ActorAssignment, ActorPerson, ActorProfile, StaffRole } from "./types.ts";

/** Строка назначения с областью (результат запроса репозитория). */
export interface AssignmentRow {
  id: string;
  role: StaffRole;
  financialRights: boolean;
  registryExportRights: boolean;
  regulationsRights: boolean;
  status: "active" | "revoked";
  validFrom: string | null;
  validUntil: string | null;
  /** Строки staff_scope; пустой массив — строк нет. */
  scopeBuildingIds: string[];
}

/** Роли, для которых пустая область означает весь ОСИ (согласовано 16.10.2026). */
const WHOLE_OSI_ROLES: readonly StaffRole[] = ["chairman", "tech_admin"];

export const SESSION_TOTAL_LIMIT_MS = 12 * 60 * 60 * 1000; // AUTH-06: 12 часов
export const SESSION_IDLE_LIMIT_MS = 30 * 60 * 1000; // AUTH-06: 30 минут бездействия

export function isAssignmentEffective(
  row: AssignmentRow,
  now: Date,
): boolean {
  if (row.status !== "active") return false;
  if (row.validFrom !== null && new Date(row.validFrom).getTime() > now.getTime()) return false;
  if (row.validUntil !== null && new Date(row.validUntil).getTime() <= now.getTime()) return false;
  return true;
}

function toActorAssignment(row: AssignmentRow): ActorAssignment {
  const scope = row.scopeBuildingIds.length === 0 && WHOLE_OSI_ROLES.includes(row.role)
    ? undefined // весь ОСИ
    : row.scopeBuildingIds;
  return {
    id: row.id,
    role: row.role,
    financialRights: row.financialRights,
    registryExportRights: row.registryExportRights,
    regulationsRights: row.regulationsRights,
    scopeBuildingIds: scope,
  };
}

/**
 * buildActor — единственная точка сборки Actor. Вход не выдаёт роль: без
 * действующих назначений Actor не имеет полномочий (AUTH-01).
 */
export function buildActor(
  person: ActorPerson,
  profile: ActorProfile,
  assignmentRows: readonly AssignmentRow[],
  now: Date,
): Actor {
  return {
    profile,
    person,
    assignments: assignmentRows
      .filter((row) => isAssignmentEffective(row, now))
      .map(toActorAssignment),
    emulation: null,
  };
}
