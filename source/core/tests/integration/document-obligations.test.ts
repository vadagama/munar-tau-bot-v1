import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { SEED } from "./helpers.ts";
import { runTemplate, saveTemplate } from "../../src/domains/tasks/templates.ts";
import { listObligations, reassignObligation } from "../../src/domains/documents/obligations.ts";
import { actorForPerson, listDocuments } from "../../src/domains/documents/service.ts";
import { processScheduledJobs } from "../../src/domains/tasks/schedule.ts";

async function configureDocumentTime(db: ReturnType<typeof import("./helpers.ts").createTestDb>) {
  await db.query(`insert into time_rule_version(rule_id,version,params,reason)
    select id,1,'{"hours":24,"clock":"calendar"}'::jsonb,'VS-8 test fixture' from time_rule
    where key in ('document_prepare','document_after_acceptance') on conflict(rule_id,version) do nothing`);
}

describeWithDb("DOC/WRK-18: правила методички и устойчивые обязанности", getDb => {
  it("создаёт требования атомарно по версии шаблона, повтор не дублирует и передача не сдвигает срок", async () => {
    const db = getDb(), s = await setupTasks(db);
    // Только конфигурация Sydney: эти часы не являются нормативами ОСИ.
    await configureDocumentTime(db);
    const rule = { kind: "act", basis: "Тестовый регламент", prepared_by: s.worker.person.id, reviewer_id: s.admin.person.id, signed_required: false };
    const template = await saveTemplate(s.deps, s.admin, null, {
      name: "Работа с актом", title: "Проверка узла", instruction: "Инструкция", buildings: [SEED.building1], required_evidence: [],
      document_requirements: [{ ...rule, phase: "before_acceptance" }, { ...rule, phase: "after_acceptance" }],
    }, "document-template");
    const input = { version: template.version, due_at: "2099-01-01T12:00:00Z", assignee_person_id: s.worker.person.id };
    const launch = await runTemplate(s.deps, s.admin, String(template.id), input, "document-run");
    expect(await runTemplate(s.deps, s.admin, String(template.id), input, "document-run")).toEqual(launch);
    const [task] = await db.query("select document_required,is_required from task where id=$1", [launch.task_id]);
    expect(task).toMatchObject({ document_required: true, is_required: true });
    const duties = await listObligations(s.deps, s.admin, { taskId: String(launch.task_id) });
    expect(duties.items).toHaveLength(2);
    const after = duties.items.find(o => o.phase === "after_acceptance")!;
    expect(after.rule_snapshot).toMatchObject({ template: { id: template.id, version: template.version } });
    const reassigned = await reassignObligation(s.deps, s.admin, String(after.id), {
      expected_version: after.version, prepared_by: s.worker.person.id, reviewer_id: s.admin.person.id, reason: "Проверены действующие ответственные",
    }, "document-reassign");
    expect(reassigned.due_at).toEqual(after.due_at);
    expect(reassigned.rule_version_id).toBe(after.rule_version_id);
    await db.query("update common_work set state='completed' where id=$1", [launch.common_work_id]);
    const remaining = await listObligations(s.deps, s.worker, { taskId: String(launch.task_id) });
    expect(remaining.items.find(o => o.id === after.id)).toMatchObject({ completed_at: null });
    // Новый пакетный путь каталога должен работать и на реальном SQL.
    const [document] = await db.query<{ id: string }>(`insert into document(title,kind,audience,document_date,task_id,prepared_by,reviewer_id,created_by,is_test)
      values('Акт','act','staff',current_date,$1,$2,$3,$3,true) returning id`, [launch.task_id, s.worker.person.id, s.admin.person.id]);
    await db.query("insert into document_scope(document_id,building_id) values($1,$2)", [document!.id, SEED.building1]);
    expect((await listDocuments(s.deps, s.worker)).items).toEqual([expect.objectContaining({ id: document!.id })]);
    await db.query("update staff_assignment set status='revoked' where person_id=$1", [s.worker.person.id]);
    const former = await actorForPerson(db, s.worker.person.id, true);
    expect(await listDocuments(s.deps, former)).toEqual({ items: [], total: 0 });
  }, 300_000);
  it("плановый запуск использует зафиксированную методичку и сохраняет её происхождение в обязанности", async () => {
    const db = getDb(), s = await setupTasks(db);
    await configureDocumentTime(db);
    const input = { name: "Регламентный акт", title: "Осмотр", instruction: "Старая инструкция", buildings: [SEED.building1], required_evidence: [],
      document_requirements: [{ kind: "act", phase: "before_acceptance", basis: "Старое основание", prepared_by: s.worker.person.id, reviewer_id: s.admin.person.id, signed_required: false }] };
    const original = await saveTemplate(s.deps, s.admin, null, input, "scheduled-template");
    await saveTemplate(s.deps, s.admin, String(original.id), { ...input, version: 1, instruction: "Новая инструкция", document_requirements: [], reason: "Новая редакция" }, "scheduled-edit");
    const [job] = await db.query<{ id: string }>("insert into job_queue(kind,payload,dedup_key) values('task.schedule',$1::text::jsonb,'document-schedule') returning id", [JSON.stringify({
      actorId: s.admin.person.id, templateId: original.id, templateVersion: 1, blueprint: original.blueprint, buildings: [SEED.building1], isTest: true,
      dueAt: "2099-01-01T12:00:00Z", assigneeId: s.worker.person.id,
    })]);
    await db.query("insert into job_run(template_id,template_version,scheduled_at,schedule_version,queue_id) values($1,1,now(),1,$2)", [original.id, job!.id]);
    await processScheduledJobs(s.deps, Date.now() + 300_000);
    const [run] = await db.query<{ state: string; task_id: string }>("select q.state,r.task_id from job_queue q join job_run r on r.queue_id=q.id where q.id=$1", [job!.id]);
    expect(run!.state).toBe("done");
    const [task] = await db.query("select instruction,template_version from task where id=$1", [run!.task_id]);
    expect(task).toMatchObject({ instruction: "Старая инструкция", template_version: 1 });
    const duties = await listObligations(s.deps, s.admin, { taskId: run!.task_id });
    expect(duties.items).toHaveLength(1);
    expect(duties.items[0]!.rule_snapshot).toMatchObject({ template: { id: original.id, version: 1 } });
  }, 300_000);
});
