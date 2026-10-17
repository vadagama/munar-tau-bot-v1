import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
import { sweepTaskTimers } from "../../src/domains/tasks/timing.ts";
import { saveTemplate } from "../../src/domains/tasks/templates.ts";
import {
  enqueueSchedules,
  processScheduledJobs,
  saveSchedule,
  scheduleView,
} from "../../src/domains/tasks/schedule.ts";

describeWithDb("VS-5 интеграция с заданиями", (getDb) => {
  it(
    "молчание не означает принятия; эскалация сохраняет версию, принятие отменяет таймер",
    async () => {
      const started = Date.now();
      const phase = (name: string) =>
        console.info(`[task-timing] ${name}: ${Date.now() - started}ms`);
      const { deps, admin, worker, input } = await setupTasks(getDb());
      phase("setup");
      const task = await createTask(deps, admin, input, "assign");
      await getDb().query(
        "update timer set due_at=now()-interval '1 minute' where entity_id=$1",
        [task.id],
      );
      phase("created");
      await sweepTaskTimers(deps);
      phase("swept");
      expect(
        (await getDb().query("select state from task where id=$1", [task.id]))[
          0
        ]!.state,
      ).toBe("awaiting_acceptance");
      expect(
        await getDb().query(
          "select id from timer where entity_id=$1 and stage like 'task_deputy:%' and state='pending'",
          [task.id],
        ),
      ).toHaveLength(1);
      await transitionTask(deps, worker, task.id, {
        action: "accept",
        version: task.version,
      }, "accept");
      expect(
        await getDb().query(
          "select id from timer where entity_id=$1 and state='pending'",
          [task.id],
        ),
      ).toHaveLength(0);
      phase("accepted");
    },
    240000,
  );
  it(
    "JOB-05/06: конкурентные тики создают два отдельных запуска; просроченный не закрывается; версия снимка неизменна",
    async () => {
      const { deps, admin } = await setupTasks(getDb());
      const template = await saveTemplate(deps, admin, null, {
        name: "Регулярная проверка",
        title: "Осмотр",
        instruction: "Методичка 1",
        buildings: [
          SEED.building1,
        ],
        required_evidence: [],
      }, "template");
      const first = new Date(Date.now() - 25 * 3600000);
      await saveSchedule(deps, admin, String(template.id), {
        enabled: true,
        next_run_at: first.toISOString(),
        interval_hours: 24,
        due_hours: 1,
        version: 0,
      });
      await Promise.all([
        enqueueSchedules(deps, new Date(), Date.now() + 120000),
        enqueueSchedules(deps, new Date(), Date.now() + 120000),
      ]);
      expect(await getDb().query("select id from job_run")).toHaveLength(2);
      await saveTemplate(deps, admin, String(template.id), {
        name: "Регулярная проверка",
        title: "Осмотр",
        instruction: "Методичка 2",
        buildings: ["11111111-1111-1111-1111-111111111101"],
        required_evidence: [],
        version: 1,
        reason: "Новая методичка",
      }, "v2");
      await processScheduledJobs(deps, Date.now() + 240000);
      await processScheduledJobs(deps, Date.now() + 240000);
      const tasks = await getDb().query(
        "select id,state,instruction,template_version,version from task",
      );
      expect(tasks).toHaveLength(2);
      expect(
        tasks.every((t) =>
          t.state === "created" && t.instruction === "Методичка 1" &&
          t.template_version === 1
        ),
      ).toBe(true);
      await transitionTask(deps, admin, String(tasks[0]!.id), {
        action: "cancel",
        stop_checked: true,
        version: tasks[0]!.version,
        reason: "Отмена после срока",
      }, "cancel-late");
      expect(
        (await getDb().query("select missed_at from job_run where task_id=$1", [
          tasks[0]!.id,
        ]))[0]!.missed_at,
      ).toBeTruthy();
      await sweepTaskTimers(deps, new Date(), Date.now() + 120000);
      expect(
        (await getDb().query("select state,overdue_at from task")).every((t) =>
          ["created", "canceled"].includes(String(t.state)) && t.overdue_at
        ),
      ).toBe(true);
      const view = await scheduleView(deps, admin, String(template.id));
      expect(view.runs.every((r) => r.missed_at)).toBe(true);
      // Перенос шаблона не переносит область уже созданных заданий.
      await getDb().query("update job_template set buildings=$2 where id=$1", [
        template.id,
        [SEED.building2],
      ]);
      const otherAdmin = {
        ...admin,
        assignments: admin.assignments.map((a) => ({
          ...a,
          scopeBuildingIds: [SEED.building2],
        })),
      };
      expect((await scheduleView(deps, otherAdmin, String(template.id))).runs)
        .toEqual([]);
    },
    480000,
  );
});
