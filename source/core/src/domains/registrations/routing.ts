import { rolesGranting } from "../../pdp/roles.ts";
import type { StaffRole } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";

export async function reviewers(
  exec: DbExecutor,
  _buildingId: string,
  role: string,
  isTest = false,
): Promise<string[]> {
  const rows = await exec.query<{ person_id: string }>(
    `select distinct a.person_id from staff_assignment a join person n on n.id=a.person_id
    where n.status='active' and n.is_test=$2 and a.role::text=any($1::text[]) and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`,
    [rolesGranting(role as StaffRole), isTest],
  );
  return rows.map((r) => r.person_id);
}
export async function initialStage(
  exec: DbExecutor,
  buildingId: string,
  isTest = false,
): Promise<string> {
  if ((await reviewers(exec, buildingId, "administrator", isTest)).length)
    return "administrator";
  if ((await reviewers(exec, buildingId, "deputy", isTest)).length)
    return "deputy";
  return "chairman";
}
