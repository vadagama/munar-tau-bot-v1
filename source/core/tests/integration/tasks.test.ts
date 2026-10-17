import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED, applyMigrations } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";
import type { DbClient } from "../../src/db/client.ts";
import { createRequest } from "../../src/domains/requests/service.ts";
import { createTask, getTask, transitionTask } from "../../src/domains/tasks/service.ts";
async function setup(db: DbClient) {
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
describeWithDb("VS-4 задания: SQL/PDP/повторы", getDb => {
  it("повтор создания один; исполнитель принимает явно; конкурентная запись — 409", async () => {
    const {deps,admin,worker,input} = await setup(getDb());
    const [a,b] = await Promise.all([createTask(deps,admin,input,"create"),createTask(deps,admin,input,"create")]);
    expect(a.id).toBe(b.id); expect(a.state).toBe("awaiting_acceptance");
    await expect(transitionTask(deps,worker,a.id,{action:"start",version:a.version},"start")).rejects.toMatchObject({code:"INVALID_TRANSITION"});
    const accepted = await transitionTask(deps,worker,a.id,{action:"accept",version:a.version},"accept");
    expect(accepted.state).toBe("accepted");
    expect((await transitionTask(deps,worker,a.id,{action:"accept",version:a.version},"accept")).version).toBe(accepted.version);
    await expect(transitionTask(deps,worker,a.id,{action:"start",version:a.version},"stale")).rejects.toMatchObject({code:"CONCURRENT_MODIFICATION"});
    expect(await getDb().query("select id from task")).toHaveLength(1);
    expect(await getDb().query("select id from task_log")).toHaveLength(2);
    expect(await getDb().query("select id from notification where channel='telegram'")).toHaveLength(0);
  });
  it("приостановка/переназначение сохраняют срок, начало и историю; отзыв доступа действует и на replay", async () => {
    const {deps,admin,worker,input,request} = await setup(getDb());
    let t = await createTask(deps,admin,input,"create");
    t = await transitionTask(deps,worker,t.id,{action:"accept",version:t.version},"accept");
    t = await transitionTask(deps,worker,t.id,{action:"start",version:t.version},"start");
    expect(t.started_at).not.toBeNull();
    expect((await getDb().query("select work_execution_required from request where id=$1",[request.id]))[0]?.work_execution_required).toBe(true);
    const due = t.due_at;
    t = await transitionTask(deps,admin,t.id,{action:"suspend",version:t.version,reason:"Ожидаем деталь",next_action:"Получить деталь",next_action_at:"2026-11-01T10:00:00Z"},"pause");
    expect(t.prev_state).toBe("in_progress");
    t = await transitionTask(deps,admin,t.id,{action:"resume",version:t.version,reason:"Деталь получена"},"resume");
    expect(t.state).toBe("in_progress");
    t = await transitionTask(deps,admin,t.id,{action:"reassign",version:t.version,reason:"Замена исполнителя"},"reassign");
    expect(t.due_at).toEqual(due); expect(t.started_at).not.toBeNull();
    await expect(getTask(deps,worker,t.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(transitionTask(deps,worker,t.id,{action:"accept",version:1},"accept")).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(getDb().query("delete from task_log where task_id=$1",[t.id])).rejects.toThrow(/append-only/);
  });
  it("миграции повторяемы, клиентские роли не получают таблицы VS-4", async () => {
    await applyMigrations(getDb());
    const rows = await getDb().query<{relname:string;relrowsecurity:boolean;allowed:boolean}>(`select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') as allowed
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('task','task_log','task_report','visit','common_work','common_work_request','job_template','job_template_version','common_work_log')`);
    expect(rows).toHaveLength(9);
    expect(rows.every(r=>r.relrowsecurity && !r.allowed)).toBe(true);
  });
});
