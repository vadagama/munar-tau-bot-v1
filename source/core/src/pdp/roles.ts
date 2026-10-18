import { type Actor, STAFF_ROLES, type StaffRole } from "./types.ts";

export const ROLE_LABELS: Record<StaffRole, string> = {
  chairman: "Председатель",
  administrator: "Администратор",
  deputy: "Заместитель",
  executor: "Исполнитель",
  duty: "Дежурный",
  doc_reviewer: "Проверяющий документов",
  finance: "Финансы",
  tech_admin: "Технический администратор",
};
export const ROLE_LABELS_KK: Record<StaffRole, string> = {
  chairman: "Төраға",
  administrator: "Әкімші",
  deputy: "Орынбасар",
  executor: "Орындаушы",
  duty: "Кезекші",
  doc_reviewer: "Құжаттарды тексеруші",
  finance: "Қаржы",
  tech_admin: "Техникалық әкімші",
};
const RANK: Record<StaffRole, number> = {
  chairman: 4,
  administrator: 3,
  deputy: 2,
  executor: 1,
  duty: 1,
  doc_reviewer: 1,
  finance: 1,
  tech_admin: 0,
};
const INHERITS: Partial<Record<StaffRole, readonly StaffRole[]>> = {
  chairman: [
    "administrator",
    "deputy",
    "executor",
    "duty",
    "doc_reviewer",
    "finance",
  ],
  administrator: ["deputy", "executor", "duty", "doc_reviewer", "finance"],
  deputy: ["executor", "duty", "doc_reviewer", "finance"],
};
export function effectiveRoles(roles: readonly StaffRole[]): StaffRole[] {
  return [
    ...new Set(roles.flatMap((role) => [role, ...(INHERITS[role] ?? [])])),
  ];
}
export function rolesGranting(role: StaffRole): StaffRole[] {
  return STAFF_ROLES.filter((source) =>
    effectiveRoles([source]).includes(role)
  );
}
export function canManageRole(
  roles: readonly StaffRole[],
  target: StaffRole,
): boolean {
  return !["chairman", "tech_admin"].includes(target) &&
    roles.some((role) => RANK[role] > RANK[target]);
}
export function canManageStaff(
  actor: Actor,
  targetId: string,
  roles: readonly StaffRole[],
): boolean {
  const own = actor.assignedRoles ?? actor.assignments.map((a) => a.role);
  return actor.emulation === null && actor.person.status === "active" &&
    actor.person.id !== targetId &&
    own.some((role) => RANK[role] >= 2) &&
    roles.every((role) => canManageRole(own, role));
}
/** Наследование вычисляется на каждый запрос, дополнительных назначений в БД нет. */
export function withRoleHierarchy(actor: Actor, buildings?: string[]): Actor {
  const assignedRoles = [...new Set(actor.assignments.map((a) => a.role))];
  return {
    ...actor,
    assignedRoles,
    globalStaff: buildings !== undefined,
    assignments: actor.assignments.flatMap((a) =>
      effectiveRoles([a.role]).map((role) => ({
        ...a,
        role,
        inherited: role !== a.role,
        scopeBuildingIds: buildings ?? a.scopeBuildingIds,
        financialRights: effectiveRoles([a.role]).includes("finance"),
        registryExportRights: ["chairman", "administrator"].includes(a.role),
        regulationsRights: (a.role === "tech_admin" && a.regulationsRights) ||
          ["chairman", "administrator"].includes(a.role),
      }))
    ),
  };
}
