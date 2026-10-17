import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { saveTemplate } from "../../src/domains/tasks/templates.ts";
import {
  enqueueSchedules,
  processScheduledJobs,
  retryScheduledJob,
  saveSchedule,
  scheduleView,
} from "../../src/domains/tasks/schedule.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
import { requireTask } from "../../src/domains/tasks/access.ts";
import {
  dispatchNotices,
  recipientActor,
} from "../../src/domains/notifications/service.ts";
import { sendNotifications } from "../../src/domains/notifications/delivery.ts";

describeWithDb("VS-5 отзыв назначения", (getDb) => {
  it(
    "прежний исполнитель получает только личный факт снятия, без доступа к карточке",
    async () => {
      const { deps, admin, worker, input } = await setupTasks(getDb());
      const task = await createTask(deps, admin, input, "create");
      await transitionTask(deps, admin, task.id, {
        action: "reassign",
        version: task.version,
        reason: "Смена исполнителя",
      }, "reassign");
      await expect(requireTask(getDb(), worker, task.id)).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
      await dispatchNotices(deps, Date.now() + 120000);
      await sendNotifications(deps, async () => {
        throw new Error("No external delivery");
      }, Date.now() + 120000);
      const rows = await getDb().query(
        "select text,state,task_id,channel from notification where recipient_person_id=$1",
        [worker.person.id],
      );
      const removed = rows.filter((r) =>
        String(r.text).includes("назначение на задание")
      );
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({
        state: "sent",
        task_id: null,
        channel: "simulator",
      });
      expect(removed[0]!.text).not.toContain("карточку");
      expect(
        rows.filter((r) => r.task_id === task.id && r.state !== "canceled"),
      ).toHaveLength(0);
    },
    240000,
  );

  it(
    "окончательная ошибка назначения создаёт один контакт и уведомляет резерв",
    async () => {
      const { deps, admin, worker, input } = await setupTasks(getDb());
      const task = await createTask(deps, admin, input, "assignment");
      await getDb().query(
        "with a as (insert into staff_assignment(person_id,role) values ($1,'deputy') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a",
        [admin.person.id, SEED.building1],
      );
      await dispatchNotices(deps, Date.now() + 120000);
      await getDb().query(
        "update notification set state='failed',last_error='BOT_BLOCKED' where task_id=$1 and recipient_person_id=$2",
        [task.id, worker.person.id],
      );
      for (let i = 0; i < 2; i++) {
        await sendNotifications(deps, async () => {
          throw new Error("No external delivery");
        }, Date.now() + 120000);
      }
      expect(
        await getDb().query(
          "select f.notification_id from notification_followup f join notification n on n.id=f.notification_id where n.task_id=$1",
          [task.id],
        ),
      ).toHaveLength(1);
      const reserve = await getDb().query(
        "select payload from outbox where dedup_key like 'delivery-failed:%:deputy:%'",
      );
      expect(reserve).toHaveLength(1);
      expect(JSON.stringify(reserve[0]!.payload)).toContain(admin.person.id);
    },
    240000,
  );
  it(
    "отзыв прав автора блокирует запуск; другой уполномоченный сотрудник явно повторяет dead",
    async () => {
      const { deps, admin, worker } = await setupTasks(getDb());
      const template = await saveTemplate(deps, admin, null, {
        name: "Проверка",
        title: "Осмотр",
        instruction: "Осмотреть",
        buildings: [SEED.building1],
        required_evidence: [],
      }, "schedule");
      await saveSchedule(deps, admin, String(template.id), {
        enabled: true,
        next_run_at: new Date(Date.now() - 60000).toISOString(),
        interval_hours: 24,
        due_hours: 8,
        version: 0,
      });
      await enqueueSchedules(deps, new Date(), Date.now() + 120000);
      await getDb().query(
        "update staff_assignment set status='revoked' where person_id=$1",
        [admin.person.id],
      );
      await getDb().query("update job_queue set attempts=4");
      await processScheduledJobs(deps, Date.now() + 120000);
      expect((await getDb().query("select state,last_error from job_queue"))[0])
        .toMatchObject({ state: "dead", last_error: "FORBIDDEN" });
      expect(await getDb().query("select id from task")).toHaveLength(0);
      const [run] = await getDb().query("select id from job_run");
      await expect(retryScheduledJob(deps, worker, String(run!.id))).rejects
        .toMatchObject({ code: "FORBIDDEN" });
      await getDb().query(
        "with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a",
        [worker.person.id, SEED.building1],
      );
      const replacement = (await recipientActor(getDb(), worker.person.id))!;
      await retryScheduledJob(deps, replacement, String(run!.id));
      await processScheduledJobs(deps, Date.now() + 120000);
      expect(
        (await scheduleView(deps, replacement, String(template.id))).runs[0],
      ).toMatchObject({ state: "done" });
      expect(await getDb().query("select id from task")).toHaveLength(1);
    },
    300000,
  );
});
