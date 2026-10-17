import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask,getTask } from "../../src/domains/tasks/service.ts";
import { submitTaskReport } from "../../src/domains/tasks/reports.ts";
import {
  completeFile,
  type FileStorage,
  fileUrl,
  prepareFile,
  uploadFile,
} from "../../src/domains/requests/files.ts";
const report = {
  performed_work: "Заменён кран",
  performed_at: "2026-10-17T10:00:00Z",
  result: "Протечка устранена",
  limitations: "",
};
describeWithDb("VS-4 отчёт и приёмка WRK-16", (getDb) => {
  it("ROL-02d: председатель-исполнитель не принимает собственный отчёт",async()=>{
    const {deps,admin,worker,input}=await setupTasks(getDb());
    const t=await createTask(deps,admin,input,"task");
    await getDb().query("update task set state='on_review' where id=$1",[t.id]);
    await getDb().query("insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,1,'Ремонт',now(),'Готово',$2)",[t.id,worker.person.id]);
    const chair={...worker,assignments:[...worker.assignments,...admin.assignments.map(a=>({...a,role:"chairman" as const}))]};
    expect((await getTask(deps,chair,t.id)).can_approve).toBe(false);
    await expect(transitionTask(deps,chair,t.id,{action:"approve",version:t.version,report_version:1,result_checked:true},"self-approve")).rejects.toMatchObject({code:"FORBIDDEN"});
    expect((await getDb().query("select state from task where id=$1",[t.id]))[0]?.state).toBe("on_review");
  });
  it("объяснение не заменяет решение администратора; отчёт и приёмка версионные", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, {
      ...input,
      required_evidence: [{ id: "photo", required: true, kind: "photo" }],
    }, "create");
    await getDb().query(
      "update task set state='in_progress',started_at=now() where id=$1",
      [t.id],
    );
    const submitted = await submitTaskReport(deps, worker, t.id, {
      ...report,
      version: t.version,
      evidence: [{
        requirement_id: "photo",
        attachment_ids: [],
        missing_reason: "Камера сломана",
      }],
    }, "report");
    expect(submitted.state).toBe("on_review");
    await expect(
      transitionTask(deps, admin, t.id, {
        action: "approve",
        version: submitted.version,
        report_version: 1,
        result_checked: true,
      }, "bad-approve"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const accepted = await transitionTask(deps, admin, t.id, {
      action: "approve",
      version: submitted.version,
      report_version: 1,
      result_checked: true,
      evidence_decisions: [{
        requirement_id: "photo",
        reason: "Результат проверен очно",
      }],
    }, "approve");
    expect(accepted.state).toBe("accepted_admin");
    const returned = await transitionTask(deps, admin, t.id, {
      action: "return",
      version: accepted.version,
      report_version: 1,
      reason: "Обнаружена течь",
      expected_result: "Устранить течь",
      rework_due_at: "2026-11-01T10:00:00Z",
      dependency_review: "Зависимых работ нет",
    }, "return");
    expect(returned.state).toBe("rework");
    await expect(
      getDb().query(
        "update task_report set result='Подмена' where task_id=$1",
        [t.id],
      ),
    ).rejects.toThrow(/append-only/);
    expect(
      await getDb().query("select id from task_report where task_id=$1", [
        t.id,
      ]),
    ).toHaveLength(1);
  });
  it("исправление создаёт новую версию отчёта, повтор команды не создаёт третью", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, input, "create");
    await getDb().query("update task set state='in_progress' where id=$1", [
      t.id,
    ]);
    await submitTaskReport(deps, worker, t.id, {
      ...report,
      version: 1,
      evidence: [],
    }, "first");
    // Состояние нового цикла как фикстура: переходы приёмки/возврата проверяются выше.
    await getDb().query(
      "update task set state='in_progress',version=3 where id=$1",
      [t.id],
    );
    const body = {
      ...report,
      result: "Повторная проверка пройдена",
      version: 3,
      evidence: [],
    };
    const second = await submitTaskReport(deps, worker, t.id, body, "second");
    expect((await submitTaskReport(deps, worker, t.id, body, "second")).version)
      .toBe(second.version);
    const versions = await getDb().query(
      "select version,result from task_report where task_id=$1 order by version",
      [t.id],
    );
    expect(versions).toEqual([{ version: 1, result: report.result }, {
      version: 2,
      result: body.result,
    }]);
  });
  it("неполный файл не считается доказательством; complete проверяет Storage; файл отчёта неизменяем", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, {
      ...input,
      required_evidence: [{ id: "photo", required: true, kind: "photo" }],
    }, "create");
    await getDb().query("update task set state='in_progress' where id=$1", [
      t.id,
    ]);
    const file = await prepareFile(deps, worker, {
      owner_type: "task",
      owner_id: t.id,
      filename: "work.jpg",
      size: 4,
      mime: "image/jpeg",
    });
    const id = String(file.attachment_id);
    const body = {
      ...report,
      version: t.version,
      evidence: [{ requirement_id: "photo", attachment_ids: [id] }],
    };
    await expect(submitTaskReport(deps, worker, t.id, body, "report")).rejects
      .toMatchObject({ code: "VALIDATION_FAILED" });
    let stored = false;
    const storage: FileStorage = {
      put: async () => {
        stored = true;
      },
      info: async () => ({ size: stored ? 4 : 0, mime: "image/jpeg" }),
      sign: async () => "https://example.test/signed",
    };
    await expect(completeFile(deps, storage, worker, id)).rejects.toMatchObject(
      { code: "FILE_LIMIT" },
    );
    await uploadFile(
      deps,
      storage,
      worker,
      id,
      new Uint8Array([255, 216, 255, 0]),
    );
    await completeFile(deps, storage, worker, id);
    await submitTaskReport(deps, worker, t.id, body, "report");
    expect(await fileUrl(deps, storage, admin, id)).toMatchObject({
      expires_in: 300,
    });
    await expect(fileUrl(deps, storage, { ...worker, assignments: [] }, id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadFile(deps, storage, worker, id, new Uint8Array(4)))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getDb().query(
        "update attachment set filename='changed.jpg' where id=$1",
        [id],
      ),
    ).rejects.toThrow(/immutable/);
  });
});
