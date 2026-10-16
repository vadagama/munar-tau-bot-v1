// Тестовые фикстуры акторов: сборка через buildActor (настоящий сборщик).

import { buildActor, type AssignmentRow } from "../pdp/actor.ts";
import type { Actor, StaffRole } from "../pdp/types.ts";

export const B1 = "b1000000-0000-0000-0000-000000000001";
export const B2 = "b2000000-0000-0000-0000-000000000002";
export const B3 = "b3000000-0000-0000-0000-000000000003";

export function assignmentRow(
  overrides: Partial<AssignmentRow> & Pick<AssignmentRow, "role">,
): AssignmentRow {
  return {
    id: crypto.randomUUID(),
    financialRights: false,
    registryExportRights: false,
    regulationsRights: false,
    status: "active",
    validFrom: null,
    validUntil: null,
    scopeBuildingIds: [],
    ...overrides,
  };
}

/** Actor с одним действующим назначением (роли/область — аргументы). */
export function makeTestActor(
  role: StaffRole,
  scope: string[],
  opts?: { isTest?: boolean; personId?: string },
): Actor {
  const personId = opts?.personId ?? `person-${role}-${crypto.randomUUID().slice(0, 8)}`;
  const isTest = opts?.isTest ?? false;
  const person = { id: personId, fullName: `Персона ${role}`, status: "active" as const, isTest };
  const profile = { id: `profile-${personId}`, personId, language: "ru" as const, isTest };
  return buildActor(
    person,
    profile,
    [assignmentRow({ role, scopeBuildingIds: scope })],
    new Date("2026-10-16T12:00:00Z"),
  );
}
