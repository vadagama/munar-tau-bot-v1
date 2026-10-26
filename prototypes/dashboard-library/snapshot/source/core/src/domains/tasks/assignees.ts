import type { DbExecutor } from "../../db/client.ts";
import { invalid } from "../registry/validation.ts";

// ROL-02e: роль и область сотрудника не ограничивают назначение на задание.
// Истёкшие и отозванные полномочия исключаются и из списка, и при записи.
const ACTIVE_STAFF = `p.status='active' and p.is_test=$1 and a.status='active'
  and (a.valid_from is null or a.valid_from<=now())
  and (a.valid_until is null or a.valid_until>now())`;

export async function listTaskAssignees(exec: DbExecutor, isTest: boolean, buildings: string[]) {
  return exec.query<{ id: string; full_name: string; roles: string[] }>(
    `select p.id,p.full_name,array_agg(distinct a.role::text order by a.role::text) as roles
    from person p join staff_assignment a on a.person_id=p.id
    where ${ACTIVE_STAFF}
    group by p.id,p.full_name
    order by bool_or(a.role='chairman' or not exists(
      select 1 from unnest($2::uuid[]) b(id) where not exists(
        select 1 from staff_scope s where s.assignment_id=a.id and s.building_id=b.id))) desc,
      p.full_name,p.id`,
    [isTest, buildings],
  );
}

export async function requireTaskAssignee(exec: DbExecutor, id: string, isTest: boolean) {
  const [person] = await exec.query(
    `select p.id from person p join staff_assignment a on a.person_id=p.id
    where ${ACTIVE_STAFF} and p.id=$2 limit 1`,
    [isTest, id],
  );
  if (!person) invalid("Выберите действующего сотрудника ОСИ");
}
