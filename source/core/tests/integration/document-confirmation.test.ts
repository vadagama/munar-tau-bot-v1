import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import type { DbClient } from "../../src/db/client.ts";
import { taskResultSnapshot } from "../../src/domains/tasks/results.ts";
import { transitionTask } from "../../src/domains/tasks/service.ts";
import { transitionRequest } from "../../src/domains/requests/service.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";

async function administrator(db: DbClient) {
  await db.query("insert into staff_assignment(person_id,role) values($1,'administrator')", [SEED.testAdminPersonId]);
  const repo = new SqlAdminRepo();
  const [p] = await db.query<{ id: string }>("select id from profile where person_id=$1 and archived_at is null", [SEED.testAdminPersonId]);
  return buildActorForProfile(repo, db, (await repo.getProfile(db, p!.id))!, new Date());
}

/** Фикстура только для проверки комплекта и блокировок; сервисные переходы — documents.test.ts. */
async function fixture(db: DbClient) {
  const requestId = crypto.randomUUID(), taskId = crypto.randomUUID(), reportId = crypto.randomUUID();
  const documentId = crypto.randomUUID(), versionId = crypto.randomUUID(), fileId = crypto.randomUUID();
  await db.query("insert into request(id,number,state,author_person_id,created_by,building_id,source,description,is_test) values($1,$2,'in_work',$3,$3,$4,'admin','Проверка комплекта',true)", [requestId, `VS8-${requestId}`, SEED.testAdminPersonId, SEED.building1]);
  await db.query("insert into task(id,request_id,title,instruction,state,assignee_person_id,due_at,is_test,created_by,document_required) values($1,$2,'Работа','Проверить','accepted_admin',$3,now(),true,$4,true)", [taskId, requestId, SEED.testExecutorPersonId, SEED.testAdminPersonId]);
  await db.query("insert into task_report(id,task_id,version,performed_work,performed_at,result,created_by) values($1,$2,1,'Работа',now(),'Выполнено',$3)", [reportId, taskId, SEED.testExecutorPersonId]);
  await db.query("insert into document(id,title,kind,audience,document_date,task_id,prepared_by,reviewer_id,created_by,is_test) values($1,'Акт','act','staff',current_date,$2,$3,$4,$4,true)", [documentId, taskId, SEED.testExecutorPersonId, SEED.testAdminPersonId]);
  await db.query("insert into attachment(id,owner_type,owner_id,bucket,storage_path,filename,size_bytes,mime,status,uploaded_by) values($1,'document',$2,'internal',$3,'act.pdf',12,'application/pdf','complete',$4)", [fileId, documentId, `${documentId}/${fileId}`, SEED.testExecutorPersonId]);
  await db.query("insert into document_version(id,document_id,version,attachment_id,prepared_by,task_report_id) values($1,$2,1,$3,$4,$5)", [versionId, documentId, fileId, SEED.testExecutorPersonId, reportId]);
  await db.query("update document_version set state='on_review' where id=$1", [versionId]);
  await db.query("update document_version set state='approved',reviewed_by=$2 where id=$1", [versionId, SEED.testAdminPersonId]);
  const [o] = await db.query<{ id: string }>(`insert into document_obligation(task_id,kind,phase,basis,prepared_by,reviewer_id,rule_version_id,rule_snapshot,due_at,document_version_id,completed_at,created_by,is_test)
    values($1,'act','before_acceptance','Тестовый регламент',$2,$3,(select id from time_rule_version order by id limit 1),'{}',now(),$4,now(),$3,true) returning id`, [taskId, SEED.testExecutorPersonId, SEED.testAdminPersonId, versionId]);
  return { requestId, taskId, reportId, documentId, versionId, obligationId: o!.id };
}

describeWithDb("WRK-18: обязательный комплект и блокировки", getDb => {
  it("реальный переход принимает задание с проверенным обязательным актом", async () => {
    const db = getDb(), s = await fixture(db), actor = await administrator(db);
    await db.query("update task set state='on_review' where id=$1", [s.taskId]);
    const [task] = await db.query<{ version: number }>("select version from task where id=$1", [s.taskId]);
    const accepted = await transitionTask({ db, audit: new SqlAuditRepo() }, actor, s.taskId,
      { action: "approve", version: task!.version, report_version: 1, result_checked: true, reason: "Результат и акт проверены" }, "accept-act");
    expect(accepted.state).toBe("accepted_admin");
  });
  it("вопрос без работ нельзя передать с незавершённым обязательством", async () => {
    const db = getDb(), s = await fixture(db), actor = await administrator(db);
    await db.query("update request set kind='question',work_execution_required=false where id=$1", [s.requestId]);
    await db.query("update document_obligation set document_version_id=null,completed_at=null where id=$1", [s.obligationId]);
    // Обязательство принадлежит самому обращению, а не необязательному заданию.
    await db.query(`insert into document_obligation(request_id,kind,phase,basis,prepared_by,reviewer_id,rule_version_id,rule_snapshot,due_at,created_by,is_test)
      values($1,'decision_basis','before_acceptance','Основание ответа',$2,$3,(select id from time_rule_version order by id limit 1),'{}',now(),$3,true)`, [s.requestId, SEED.testExecutorPersonId, SEED.testAdminPersonId]);
    const [request] = await db.query<{ version: number }>("select version from request where id=$1", [s.requestId]);
    await expect(transitionRequest({ db, audit: new SqlAuditRepo() }, actor, s.requestId,
      { action: "submit_result", expected_version: request!.version, payload: { confirmation_payload: { summary: "Ответ" } } }, "question-act"))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("принимает точную версию и отклоняет needs_fix", async () => {
    const db = getDb(), s = await fixture(db);
    const snapshot = await db.transaction(exec => taskResultSnapshot(exec, s.requestId));
    expect(snapshot.document_versions).toEqual([{ requirement_id: s.obligationId, document_id: s.documentId, document_version_id: s.versionId }]);
    await db.query("update document_version set state='needs_fix' where id=$1", [s.versionId]);
    await expect(db.transaction(exec => taskResultSnapshot(exec, s.requestId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("акт прежнего отчёта не покрывает новый результат задания", async () => {
    const db = getDb(), s = await fixture(db);
    await db.query("insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,2,'Доработка',now(),'Исправлено',$2)", [s.taskId, SEED.testExecutorPersonId]);
    await expect(db.transaction(exec => taskResultSnapshot(exec, s.requestId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("держит документ заблокированным до завершения бизнес-транзакции", async () => {
    const db = getDb(), s = await fixture(db);
    let release!: () => void, markEntered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    const holding = db.transaction(async exec => {
      const snapshot = await taskResultSnapshot(exec, s.requestId);
      markEntered();
      await gate;
      return snapshot;
    });
    try {
      await Promise.race([entered, holding]);
      await expect(db.query("select id from document where id=$1 for update nowait", [s.documentId])).rejects.toMatchObject({ code: "55P03" });
    } finally { release(); await holding; }
  });
});
