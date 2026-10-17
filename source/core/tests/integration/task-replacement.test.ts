import { transitionRequest } from "../../src/domains/requests/service.ts";
import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
describeWithDb("VS-4 замена обязательного задания", (getDb) => {
  it("без замены отмена запрещена; замена сохраняет историю и переносит неначатые зависимости", async () => {
    const { deps, admin, input, request } = await setupTasks(getDb());
    const original = await createTask(deps, admin, input, "original");
    const [replacement] = await getDb().query(
      "insert into task(request_id,title,instruction,due_at,is_test,created_by) values($1,'Замена','Проверить',now()+interval '1 day',true,$2) returning id",
      [request.id, admin.person.id],
    );
    const [dependent] = await getDb().query(
      "insert into task(request_id,title,instruction,due_at,is_test,created_by,depends_on_task_id) values($1,'Зависимое','Проверить',now()+interval '1 day',true,$2,$3) returning id",
      [request.id, admin.person.id, original.id],
    );
    const body = {
      action: "cancel",
      version: original.version,
      reason: "Изменён способ ремонта",
      stop_checked: true,
    };
    await expect(transitionTask(deps, admin, original.id, body, "missing"))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const canceled = await transitionTask(deps, admin, original.id, {
      ...body,
      replacement_task_id: replacement!.id,
    }, "cancel");
    expect(canceled.state).toBe("canceled");
    expect(canceled.is_required).toBe(false);
    expect(
      (await getDb().query("select depends_on_task_id from task where id=$1", [
        dependent!.id,
      ]))[0]?.depends_on_task_id,
    ).toBe(replacement!.id);
    const [log] = await getDb().query(
      "select meta from task_log where task_id=$1 and to_state='canceled'",
      [original.id],
    );
    expect(log!.meta).toMatchObject({
      was_required: true,
      replacement_task_id: replacement!.id,
    });
  });
  it(
    "после удовлетворения апелляции отменённый объём заменяется явно и не блокирует результат",
    async () => {
      const { deps, admin, worker, input, request } = await setupTasks(getDb());
      const old = await createTask(deps, admin, input, "original");
      const rejected = await transitionRequest(
        deps,
        admin,
        String(request.id),
        {
          action: "reject",
          expected_version: request.version,
          reason: "Вне обслуживания",
          payload: { route: "Уточнить границу ответственности" },
        },
      );
      const appealed = await transitionRequest(
        deps,
        worker,
        String(request.id),
        {
          action: "appeal_reject",
          expected_version: rejected.version,
          reason: "Общий стояк",
        },
      );
      const chair = {
        ...admin,
        assignments: admin.assignments.map((a) => ({
          ...a,
          role: "chairman" as const,
        })),
      };
      const reopened = await transitionRequest(
        deps,
        chair,
        String(request.id),
        {
          action: "uphold_appeal",
          expected_version: appealed.version,
          reason: "Обязанность ОСИ подтверждена",
        },
      );
      const replacement = await createTask(deps, admin, input, "replacement");
      const [canceled] = await getDb().query<{ version: number }>(
        "select version from task where id=$1",
        [old.id],
      );
      await transitionTask(deps, admin, old.id, {
        action: "replace_canceled",
        version: canceled!.version,
        reason: "После апелляции назначена замена",
        replacement_task_id: replacement.id,
        stop_checked: true,
      }, "replace");
      await getDb().query(
        "update task set state='accepted_admin' where id=$1",
        [replacement.id],
      );
      await getDb().query(
        "insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,1,'Замена крана',now(),'Готово',$2)",
        [replacement.id, worker.person.id],
      );
      const [current] = await getDb().query<{ version: number }>(
        "select version from request where id=$1",
        [reopened.id],
      );
      const sent = await transitionRequest(deps, admin, String(request.id), {
        action: "submit_result",
        expected_version: current!.version,
        payload: {
          confirmation_payload: { summary: "Обязательства выполнены" },
        },
      });
      expect(sent.state).toBe("awaiting_confirmation");
      expect(
        (await getDb().query("select state,is_required from task where id=$1", [
          old.id,
        ]))[0],
      ).toMatchObject({ state: "canceled", is_required: false });
    },
    240000,
  );
});
