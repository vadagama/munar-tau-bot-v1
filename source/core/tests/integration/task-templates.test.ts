import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import {
  runTemplate,
  saveTemplate,
} from "../../src/domains/tasks/templates.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
import { SEED } from "./helpers.ts";
describeWithDb("VS-4 JOB-02/03/06 версии шаблонов", (getDb) => {
  // Два запуска и редакция методички: несколько полных транзакций через удалённый pooler.
  it(
    "новая версия меняет будущие задания; старое хранит инструкцию и чек-лист; повтор запуска один",
    async () => {
      const { deps, admin, worker } = await setupTasks(getDb());
      const input = {
        name: "Осмотр",
        title: "Проверить узел",
        instruction: "Методичка 1",
        buildings: [SEED.building1],
        required_evidence: [{ id: "Фото", kind: "photo", required: true }],
      };
      const template = await saveTemplate(
        deps,
        admin,
        null,
        input,
        "create-template",
      );
      const launch = { version: 1, due_at: "2026-12-01T12:00:00Z" };
      const first = await runTemplate(
        deps,
        admin,
        String(template.id),
        launch,
        "run",
      );
      const next = await saveTemplate(deps, admin, String(template.id), {
        ...input,
        version: 1,
        instruction: "Методичка 2",
        required_evidence: [],
        reason: "Уточнён порядок",
      }, "new-version");
      expect(next.version).toBe(2);
      expect(await runTemplate(deps, admin, String(template.id), launch, "run"))
        .toEqual(first);
      const second = await createTask(deps, admin, {
        common_work_id: first.common_work_id,
        template_id: template.id,
        template_version: 2,
        due_at: launch.due_at,
      }, "future");
      const [old] = await getDb().query("select * from task where id=$1", [
        first.task_id,
      ]);
      expect(old).toMatchObject({
        instruction: "Методичка 1",
        template_version: 1,
        required_evidence: [{ id: "Фото", required: true, kind: "photo" }],
      });
      expect(second).toMatchObject({
        instruction: "Методичка 2",
        template_version: 2,
        required_evidence: [],
      });
      await getDb().query(
        "update task set state='in_progress',assignee_person_id=$2,started_at=now() where id=$1",
        [first.task_id, worker.person.id],
      );
      const revised = await transitionTask(deps, admin, String(first.task_id), {
        action: "revise_template",
        version: 1,
        template_id: template.id,
        template_version: 2,
        reason: "Явное обновление методички",
      }, "revise");
      expect(revised).toMatchObject({
        state: "created",
        assignee_person_id: null,
        instruction: "Методичка 2",
        template_version: 2,
        due_at: old!.due_at,
      });
      const [revision] = await getDb().query(
        "select meta from task_log where task_id=$1 and meta->>'action'='revise_template'",
        [first.task_id],
      );
      expect(revision!.meta).toMatchObject({
        previous_template_version: 1,
        previous_instruction: "Методичка 1",
      });
      expect(await getDb().query("select id from common_work")).toHaveLength(1);
      await expect(
        getDb().query("delete from job_template_version where template_id=$1", [
          template.id,
        ]),
      ).rejects.toThrow(/append-only/);
    },
    180000,
  );
});
