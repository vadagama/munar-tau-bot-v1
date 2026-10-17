import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
import {
  createCommonWork,
  getCommonWork,
  transitionCommonWork,
} from "../../src/domains/tasks/common.ts";
import { SEED } from "./helpers.ts";
const input = {
  title: "Замена трубы",
  plan: "Заменить участок",
  due_at: "2026-12-01T12:00:00Z",
  building_ids: [SEED.building1],
};
describeWithDb("VS-4 общая работа", (getDb) => {
  it("общее задание использует область работы; начало фиксируется во связанном обращении", async () => {
    const { deps, admin, worker, request } = await setupTasks(getDb());
    await expect(createCommonWork(deps, worker, input, "denied")).rejects
      .toMatchObject({ code: "FORBIDDEN" });
    const work = await createCommonWork(deps, admin, {
      ...input,
      request_ids: [request.id],
    }, "work");
    expect(
      (await createCommonWork(deps, admin, {
        ...input,
        request_ids: [request.id],
      }, "work")).id,
    ).toBe(work.id);
    const task = await createTask(deps, admin, {
      common_work_id: work.id,
      title: "Труба",
      instruction: "Проверить стыки",
      due_at: input.due_at,
      assignee_person_id: worker.person.id,
    }, "task");
    await getDb().query("update task set state='accepted' where id=$1", [
      task.id,
    ]);
    await transitionTask(deps, worker, task.id, {
      action: "start",
      version: task.version,
    }, "start");
    expect((await getCommonWork(deps, admin, work.id)).state).toBe(
      "in_progress",
    );
    const [r] = await getDb().query(
      "select work_execution_required,work_started_at from request where id=$1",
      [request.id],
    );
    expect(r!.work_execution_required).toBe(true);
    expect(r!.work_started_at).not.toBeNull();
  });
  it("возврат принятого задания возобновляет общую работу и сохраняет дату прежнего завершения в истории", async () => {
    const { deps, admin, worker } = await setupTasks(getDb());
    const work = await createCommonWork(deps, admin, input, "work");
    const task = await createTask(deps, admin, {
      common_work_id: work.id,
      title: "Труба",
      instruction: "Проверить стыки",
      due_at: input.due_at,
      assignee_person_id: worker.person.id,
    }, "task");
    await getDb().query(
      "update task set state='accepted_admin',started_at=now() where id=$1",
      [task.id],
    );
    await getDb().query(
      "insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,1,'Замена',now(),'Готово',$2)",
      [task.id, worker.person.id],
    );
    const current = await getCommonWork(deps, admin, work.id);
    const completed = await transitionCommonWork(deps, admin, work.id, {
      version: current.version,
      action: "complete",
      reason: "Объём принят",
    }, "complete");
    await transitionTask(deps, admin, task.id, {
      version: task.version,
      action: "return",
      report_version: 1,
      reason: "Дефект",
      expected_result: "Устранить течь",
      rework_due_at: input.due_at,
      dependency_review: "Зависимых работ нет",
    }, "return");
    const returned = await getCommonWork(deps, admin, work.id);
    expect(returned.state).toBe("in_progress");
    expect(returned.completed_at).toBeNull();
    expect(returned.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            previous_completed_at: new Date(completed.completed_at!)
              .toISOString(),
          }),
        }),
      ]),
    );
  });
  it("отмена требует разбора каждого обращения и не отменяет его автоматически", async () => {
    const { deps, admin, request } = await setupTasks(getDb());
    const work = await createCommonWork(deps, admin, {
      ...input,
      request_ids: [request.id],
    }, "work");
    const task = await createTask(deps, admin, {
      common_work_id: work.id,
      title: "Остановить",
      instruction: "Проверить",
      due_at: input.due_at,
    }, "task");
    const current = await getCommonWork(deps, admin, work.id);
    const body = {
      version: current.version,
      action: "cancel",
      stop_checked: true,
      reason: "Иной способ ремонта",
    };
    await expect(transitionCommonWork(deps, admin, work.id, body, "incomplete"))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await transitionCommonWork(deps, admin, work.id, {
      ...body,
      request_decisions: [{
        request_id: request.id,
        reason: "Создать локальное задание",
      }],
    }, "cancel");
    expect(
      (await getDb().query("select state from request where id=$1", [
        request.id,
      ]))[0]?.state,
    ).toBe(request.state);
    expect(
      (await getDb().query("select state,is_required from task where id=$1", [
        task.id,
      ]))[0],
    ).toMatchObject({ state: "canceled", is_required: true });
  });
});
