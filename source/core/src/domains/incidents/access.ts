import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import type { Row } from "../registry/validation.ts";
import { audienceMember, type IncidentScope } from "./audience.ts";
import type { IncidentState } from "./fsm.ts";
export interface IncidentRow extends Row {
  id: string;
  number: string;
  state: IncidentState;
  version: number;
  is_test: boolean;
  responsible_person_id: string;
  published: boolean;
  public_text: string | null;
  title: string;
  service: string;
  place: string;
  forecast: string;
  next_update_at: string | null;
}
export async function incidentScope(
  exec: DbExecutor,
  id: string,
): Promise<IncidentScope[]> {
  return exec.query<IncidentScope>(
    "select * from incident_scope where incident_id=$1 and active order by id",
    [id],
  );
}
export function incidentResource(
  row: IncidentRow,
  scope: IncidentScope[],
  member = false,
) {
  return {
    incidentAccess: {
      buildingIds: [...new Set(scope.map((s) => s.building_id))],
      isTest: row.is_test,
      responsibleId: row.responsible_person_id,
      published: row.published,
      member,
    },
  };
}
export async function requireIncident(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  action: "incident.read" | "incident.manage" | "incident.link" =
    "incident.read",
  lock = false,
) {
  const [row] = await exec.query<IncidentRow>(
    `select * from incident where id=$1${lock ? " for update" : ""}`,
    [id],
  );
  if (!row) throw new ApiError("NOT_FOUND");
  const scope = await incidentScope(exec, id);
  const resource = incidentResource(
    row,
    scope,
    action === "incident.read" && await audienceMember(exec, actor, scope),
  );
  if (!can(actor, action, resource).allow) {
    throw new ApiError(action === "incident.read" ? "NOT_FOUND" : "FORBIDDEN");
  }
  return { row, scope };
}
