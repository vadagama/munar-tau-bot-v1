import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import {
  getRequest,
  transitionRequest,
} from "../../src/domains/requests/service.ts";
import { transitionTask } from "../../src/domains/tasks/service.ts";
import { SEED } from "./helpers.ts";
describeWithDb("VS-4 ADR-006 персональная приёмка", (getDb) => {
  it(
    "общий результат не обходит локальную работу и не закрывает другие обращения",
    async () => {
      const { deps, admin, worker, request } = await setupTasks(getDb());
      await getDb().query(
        "update request set state='in_work',work_execution_required=true where id=$1",
        [request.id],
      );
      const [second] = await getDb().query(
        `insert into request(number,author_person_id,premises_id,building_id,kind,description,state,is_test,source,created_by,work_execution_required)
   select 'VS4-result-'||gen_random_uuid(),author_person_id,premises_id,building_id,kind,'Вторая заявка','in_work',is_test,source,created_by,true from request where id=$1 returning *`,
        [request.id],
      );
      const [work] = await getDb().query(
        "insert into common_work(title,state,building_ids,is_test,created_by,plan,due_at) values('Общий ремонт','completed',$1,true,$2,'Заменить участок',now()) returning id",
        [[SEED.building1], admin.person.id],
      );
      await getDb().query(
        "insert into common_work_request(common_work_id,request_id) values($1,$2),($1,$3)",
        [work!.id, request.id, second!.id],
      );
      const [task] = await getDb().query(
        "insert into task(common_work_id,title,instruction,due_at,is_test,created_by,assignee_person_id,state) values($1,'Общий ремонт','Проверить',now(),true,$2,$3,'accepted_admin') returning id",
        [work!.id, admin.person.id, worker.person.id],
      );
      const [report] = await getDb().query(
        "insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,1,'Заменён участок',now(),'Течь устранена',$2) returning id",
        [task!.id, worker.person.id],
      );
      await getDb().query(
        "insert into task(request_id,title,instruction,due_at,is_test,created_by) values($1,'Локальный кран','Проверить',now(),true,$2)",
        [request.id, admin.person.id],
      );
      const submit = {
        action: "submit_result",
        expected_version: 1,
        payload: { confirmation_payload: { summary: "Ремонт завершён" } },
      };
      await expect(
        transitionRequest(deps, admin, String(request.id), {
          ...submit,
          expected_version: request.version,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(
        transitionRequest(deps, admin, String(second!.id), {
          ...submit,
          payload: {
            confirmation_payload: {
              summary: "Ремонт",
              task_report_ids: [crypto.randomUUID()],
            },
          },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const sent = await transitionRequest(
        deps,
        admin,
        String(second!.id),
        submit,
      );
      const card = await getRequest(deps, worker, String(second!.id));
      expect((card.confirmation as { payload: unknown }).payload).toMatchObject(
        {
          task_report_ids: [report!.id],
          task_results: [{ report_id: report!.id, result: "Течь устранена" }],
        },
      );
      await expect(
        transitionTask(deps, admin, String(task!.id), {
          action: "return",
          version: 1,
          report_version: 1,
          reason: "Дефект",
          expected_result: "Устранить",
          rework_due_at: "2026-12-01T00:00:00Z",
          dependency_review: "Проверено",
        }, "return-pending"),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining("отзовите"),
      });
      // Даже повреждённый/устаревший снимок нельзя подтвердить новым комплектом.
      await getDb().query(
        "insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,2,'Повторный ремонт',now(),'Проверено повторно',$2)",
        [task!.id, worker.person.id],
      );
      await expect(
        transitionRequest(deps, worker, String(second!.id), {
          action: "confirm_result",
          expected_version: sent.version,
          payload: { confirmation_version: sent.confirmation_version },
        }),
      ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
      await expect(
        transitionRequest(deps, admin, String(second!.id), {
          action: "admin_close",
          expected_version: sent.version,
          reason: "Проверено",
        }),
      ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
      const withdrawn = await transitionRequest(
        deps,
        admin,
        String(second!.id),
        {
          action: "withdraw_report",
          expected_version: sent.version,
          reason: "Обновить комплект",
        },
      );
      const resent = await transitionRequest(deps, admin, String(second!.id), {
        ...submit,
        expected_version: withdrawn.version,
      });
      await transitionRequest(deps, worker, String(second!.id), {
        action: "confirm_result",
        expected_version: resent.version,
        payload: { confirmation_version: resent.confirmation_version },
      });
      expect(
        (await getDb().query("select state from request where id=$1", [
          request.id,
        ]))[0]?.state,
      ).toBe("in_work");
    },
    240000,
  );
  it("обязательный акт блокирует результат до документного контура", async () => {
    const { deps, admin, worker, request } = await setupTasks(getDb());
    await getDb().query("update request set state='in_work' where id=$1", [
      request.id,
    ]);
    const [task] = await getDb().query(
      "insert into task(request_id,title,instruction,due_at,is_test,created_by,assignee_person_id,state,document_required) values($1,'Ремонт','Проверить',now(),true,$2,$3,'accepted_admin',true) returning id",
      [request.id, admin.person.id, worker.person.id],
    );
    await getDb().query(
      "insert into task_report(task_id,version,performed_work,performed_at,result,created_by) values($1,1,'Ремонт',now(),'Готово',$2)",
      [task!.id, worker.person.id],
    );
    await expect(
      transitionRequest(deps, admin, String(request.id), {
        action: "submit_result",
        expected_version: request.version,
        payload: { confirmation_payload: { summary: "Готово" } },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("акт"),
    });
  });
});
