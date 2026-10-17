import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask } from "../../src/domains/tasks/service.ts";
import {
  linkProblem,
  reportProblem,
} from "../../src/domains/tasks/problems.ts";
import {
  type FileStorage,
  fileUrl,
  prepareFile,
} from "../../src/domains/requests/files.ts";
describeWithDb("VS-4 JOB-04 найденная проблема", (getDb) => {
  it(
    "фотография проверяется и раскрывается менеджеру только после сообщения; назначение решает администратор",
    async () => {
      const { deps, admin, worker, input, request } = await setupTasks(getDb());
      const task = await createTask(deps, admin, input, "task");
      await getDb().query("update task set state='in_progress' where id=$1", [
        task.id,
      ]);
      const file = await prepareFile(deps, worker, {
        owner_type: "task",
        owner_id: task.id,
        filename: "problem.jpg",
        mime: "image/jpeg",
        size: 4,
      });
      await getDb().query(
        "update attachment set status='complete' where id=$1",
        [file.attachment_id],
      );
      const storage = {
        sign: async () => "https://example.test/signed",
      } as unknown as FileStorage;
      await expect(fileUrl(deps, storage, admin, String(file.attachment_id)))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      const body = {
        location: "Подвал, дом 1",
        description: "Течь соседней трубы",
        attachment_ids: [file.attachment_id],
      };
      await expect(
        reportProblem(deps, worker, task.id, {
          ...body,
          attachment_ids: [crypto.randomUUID()],
        }, "wrong"),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const p = await reportProblem(deps, worker, task.id, body, "problem");
      expect(
        (await fileUrl(deps, storage, admin, String(file.attachment_id))).url,
      ).toContain("signed");
      const [target] = await getDb().query(
        "insert into task(request_id,title,instruction,due_at,is_test,created_by) values($1,'Новая проблема','Проверить',now(),true,$2) returning id",
        [request.id, admin.person.id],
      );
      const resolution = {
        task_id: target!.id,
        reason: "Включено в отдельный объём",
      };
      await expect(
        linkProblem(deps, worker, String(p.problem_id), resolution, "worker"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await linkProblem(
          deps,
          admin,
          String(p.problem_id),
          resolution,
          "link",
        )).task_id,
      ).toBe(target!.id);
    },
    180000,
  );
});
