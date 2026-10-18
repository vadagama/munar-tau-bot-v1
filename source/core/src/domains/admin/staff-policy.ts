import { type Actor, STAFF_ROLES, type StaffRole } from "../../pdp/types.ts";
import { canManageRole, canManageStaff } from "../../pdp/roles.ts";
import { ApiError } from "../../errors/api.ts";
export function staffRolesInput(value: unknown): StaffRole[] {
  if (
    !Array.isArray(value) || value.length > 8 ||
    value.some((r) => !STAFF_ROLES.includes(r as StaffRole)) ||
    new Set(value).size !== value.length
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Укажите неповторяющийся перечень ролей",
    );
  }
  return [...value as StaffRole[]].sort();
}
export function authorizeRoleChange(
  actor: Actor,
  targetId: string,
  previous: StaffRole[],
  next: StaffRole[],
) {
  if (
    !canManageStaff(actor, targetId, previous) ||
    next.some((role) =>
      !canManageRole(
        actor.assignedRoles ?? actor.assignments.map((a) => a.role),
        role,
      )
    )
  ) {
    throw new ApiError(
      "FORBIDDEN",
      "Можно управлять только младшими служебными ролями другого пользователя",
    );
  }
}
