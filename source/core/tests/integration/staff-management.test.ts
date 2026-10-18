import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import {
  saveStaffRoles,
  staffCandidates,
  staffDetail,
  staffList,
} from "../../src/domains/admin/staff.ts";
import { createTask, getTask } from "../../src/domains/tasks/service.ts";
import {
  dispatchNotices,
  recipientActor,
} from "../../src/domains/notifications/service.ts";
import { sendNotifications } from "../../src/domains/notifications/delivery.ts";

describeWithDb("ROL-02f: управление сотрудниками, SQL и доставка", (getDb) => {
  it(
    "смена и отзыв ролей атомарны, повтор не дублирует аудит/outbox, уведомление доставляется после отзыва",
    async () => {
      const fixture = await setupTasks(getDb()),
        deps = { ...fixture.deps, admin: new SqlAdminRepo() };
      const { admin, worker, input } = fixture;
      const task = await createTask(deps, admin, input, "staff-task");
      const before = await staffDetail(deps, admin, worker.person.id);
      const body = {
        roles: ["duty", "finance"],
        reason: "Дежурство и учёт",
        expected_version: before.version,
      };
      const changed = await saveStaffRoles(
        deps,
        admin,
        worker.person.id,
        body,
        "staff-change",
      );
      expect(
        await saveStaffRoles(
          deps,
          admin,
          worker.person.id,
          body,
          "staff-change",
        ),
      ).toEqual(changed);
      expect(
        await getDb().query(
          "select id from audit_log where action='staff.roles.changed' and entity_id=$1",
          [worker.person.id],
        ),
      ).toHaveLength(1);
      expect(
        await getDb().query(
          "select id from outbox where event_type='notification.requested' and payload->>'type'='staff.roles'",
        ),
      ).toHaveLength(1);
      const recipient = (await recipientActor(getDb(), worker.person.id))!;
      expect(recipient.assignedRoles?.sort()).toEqual(["duty", "finance"]);
      expect(await getTask(deps, recipient, task.id)).toMatchObject({
        can_execute: true,
      });
      const current = await staffDetail(deps, admin, worker.person.id);
      await saveStaffRoles(deps, admin, worker.person.id, {
        roles: [],
        reason: "Прекращение работы",
        expected_version: current.version,
      }, "staff-remove");
      const former = (await recipientActor(getDb(), worker.person.id))!;
      expect(former.assignments).toHaveLength(0);
      await expect(getTask(deps, former, task.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await staffList(deps, admin)).items).toContainEqual(
        expect.objectContaining({ id: worker.person.id, roles: [] }),
      );
      expect(await staffCandidates(deps, admin, worker.person.fullName))
        .toContainEqual(expect.objectContaining({ id: worker.person.id }));
      await dispatchNotices(deps, Date.now() + 120000);
      await sendNotifications(deps, async () => {
        throw Error("No external delivery");
      }, Date.now() + 120000);
      const delivered = await getDb().query(
        "select state,channel,bot from notification where event_type='staff.roles' and recipient_person_id=$1",
        [worker.person.id],
      );
      expect(delivered).toHaveLength(2);
      expect(
        delivered.every((n) =>
          n.state === "sent" && n.channel === "simulator" && n.bot === "worker"
        ),
      ).toBe(true);
    },
    240000,
  );
  it("конкурентные изменения одного перечня дают одну запись и один конфликт", async () => {
    const fixture = await setupTasks(getDb()),
      deps = { ...fixture.deps, admin: new SqlAdminRepo() };
    const card = await staffDetail(
      deps,
      fixture.admin,
      fixture.worker.person.id,
    );
    const outcomes = await Promise.allSettled([
      saveStaffRoles(deps, fixture.admin, fixture.worker.person.id, {
        roles: ["duty"],
        reason: "Первое изменение",
        expected_version: card.version,
      }, "one"),
      saveStaffRoles(deps, fixture.admin, fixture.worker.person.id, {
        roles: ["finance"],
        reason: "Второе изменение",
        expected_version: card.version,
      }, "two"),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "CONCURRENT_MODIFICATION" }),
      }),
    ]);
    expect(
      await getDb().query(
        "select id from audit_log where action='staff.roles.changed'",
      ),
    ).toHaveLength(1);
  });
});
