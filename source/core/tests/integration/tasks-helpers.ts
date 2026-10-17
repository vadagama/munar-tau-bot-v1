import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";
import type { DbClient } from "../../src/db/client.ts";
import { createRequest } from "../../src/domains/requests/service.ts";
export async function setupTasks(db: DbClient) {
  // Только фикстура Sydney: эти часы не являются нормативами ОСИ.
  await db.query(`insert into time_rule_version(rule_id,version,params,reason) select id,1,'{"hours":4,"clock":"calendar"}'::jsonb,'VS-5 test fixture' from time_rule where key in ('task_accept','task_escalation') on conflict(rule_id,version) do nothing`);

  await db.query(`with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id)
    insert into staff_scope(assignment_id,building_id) select id,$2 from a`, [SEED.testAdminPersonId, SEED.building1]);
  await db.query(`with a as (insert into staff_assignment(person_id,role) values ($1,'executor') returning id)
    insert into staff_scope(assignment_id,building_id) select id,$2 from a`, [SEED.testExecutorPersonId, SEED.building1]);
  const premises = crypto.randomUUID();
  await db.query("insert into premises(id,building_id,kind,number,is_test) values ($1,$2,'apartment','VS4',true)", [premises, SEED.building1]);
  await db.query("insert into connection(person_id,premises_id,role,basis,status) values ($1,$2,'owner','ownership','active')", [SEED.testExecutorPersonId,premises]);
  const repo = new SqlAdminRepo();
  const actor = async (id: string) => {
    const [p] = await db.query<{id:string}>("select id from profile where person_id=$1 and archived_at is null", [id]);
    return buildActorForProfile(repo, db, (await repo.getProfile(db,p!.id))!, new Date());
  };
  const admin = await actor(SEED.testAdminPersonId), worker = await actor(SEED.testExecutorPersonId);
  const deps = { db, audit: new SqlAuditRepo() };
  const request = await createRequest(deps,worker,{text:"Течёт кран",kind:"request",source:"bot",premises_id:premises},"request");
  const input = { request_id: request.id, title:"Замена крана", instruction:"Проверить герметичность", due_at:"2026-12-01T12:00:00Z", assignee_person_id:worker.person.id };
  return { deps,admin,worker,input,request };
}
