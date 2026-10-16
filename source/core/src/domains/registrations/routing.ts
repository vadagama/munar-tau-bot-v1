import type { DbExecutor } from "../../db/client.ts";

export async function reviewers(
  exec: DbExecutor,
  buildingId: string,
  role: string,
  isTest = false,
): Promise<string[]> {
  const rows = await exec.query<{ person_id: string }>(
    `select distinct a.person_id from staff_assignment a join person n on n.id=a.person_id
    where n.is_test=$3 and a.role::text=$2 and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
    and ($2='chairman' or exists(select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=$1))`,
    [buildingId, role, isTest],
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
