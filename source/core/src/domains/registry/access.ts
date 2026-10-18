import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Actor } from "../../pdp/types.ts";

export function registryScope(
  actor: Actor,
  exporting = false,
): string[] | null {
  const action = exporting ? "registry.export" : "registry.read";
  const decision = can(actor, action);
  if (!decision.allow) throw new ApiError("FORBIDDEN", decision.reason);
  if (actor.globalStaff || actor.assignments.some((a) => a.role === "chairman")) return null;
  return [
    ...new Set(
      actor.assignments
        .filter(
          (a) =>
            (a.role === "administrator" || a.role === "deputy") &&
            (!exporting || a.registryExportRights),
        )
        .flatMap((a) => a.scopeBuildingIds ?? []),
    ),
  ];
}

export function requireBuilding(
  actor: Actor,
  buildingId: string,
  exporting = false,
): void {
  const scope = registryScope(actor, exporting);
  if (scope !== null && !scope.includes(buildingId))
    throw new ApiError("NOT_FOUND");
}
