import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { taskAssignees, createTask, getTask, listTasks, transitionTask } from "../../src/domains/tasks/service.ts";
import { commonAssignees, createCommonWork } from "../../src/domains/tasks/common.ts";
import { requireTaskAssignee } from "../../src/domains/tasks/assignees.ts";
import { saveTemplate } from "../../src/domains/tasks/templates.ts";
import { enqueueSchedules, processScheduledJobs, saveSchedule, scheduleView } from "../../src/domains/tasks/schedule.ts";
import { noticeAllowed, recipientActor } from "../../src/domains/notifications/service.ts";
import { STAFF_ROLES } from "../../src/pdp/types.ts";

describeWithDb("ROL-02e: любой сотрудник выполняет назначенное задание", getDb => {
  it("все роли доступны в списке и при назначении независимо от домов; одно лицо не дублируется", async () => {
    const { deps, admin, worker, input, request } = await setupTasks(getDb());
    await getDb().query("update staff_scope set building_id=$2 where assignment_id in (select id from staff_assignment where person_id=$1)", [worker.person.id, SEED.building2]);
    const work = await createCommonWork(deps, admin, {
      title: "Осмотр", plan: "Проверить", due_at: input.due_at, building_ids: [SEED.building1],
    }, "common-work");
    for (const role of STAFF_ROLES) {
      await getDb().query("update staff_assignment set role=$2 where person_id=$1", [worker.person.id, role]);
      expect((await taskAssignees(deps, admin, String(request.id))).filter(p => p.id === worker.person.id))
        .toEqual([expect.objectContaining({ roles: [role] })]);
      expect(await commonAssignees(deps, admin, work.id)).toContainEqual(expect.objectContaining({ id: worker.person.id }));
      const task = await createTask(deps, admin, input, `role:${role}`);
      const actor = (await recipientActor(getDb(), worker.person.id))!;
      expect(await listTasks(deps, actor)).toContainEqual(expect.objectContaining({ id: task.id }));
      const detail = await getTask(deps, actor, task.id);
      expect(detail).toMatchObject({ can_execute: true });
      if (!["chairman","administrator","deputy"].includes(role)) expect(detail.linked_request).toBeNull();
      expect(await transitionTask(deps, actor, task.id, { action: "accept", version: task.version }, `accept:${role}`))
        .toMatchObject({ state: "accepted" });
    }
    await getDb().query("insert into staff_assignment(person_id,role) values ($1,'duty')", [worker.person.id]);
    expect((await taskAssignees(deps, admin, String(request.id))).filter(p => p.id === worker.person.id))
      .toEqual([expect.objectContaining({ roles: ["duty", "executor"] })]);
    const task = await createTask(deps, admin, { ...input, request_id: undefined, common_work_id: work.id }, "common-task");
    expect(await getTask(deps, (await recipientActor(getDb(), worker.person.id))!, task.id)).toMatchObject({ can_execute: true });
  });

  it("список и запись исключают отозванные, истёкшие, будущие, архивные и другие тестовые данные", async () => {
    const { deps, admin, worker, request } = await setupTasks(getDb());
    for (const change of [
      "status='revoked'", "valid_until=now()-interval '1 second'", "valid_from=now()+interval '1 day'",
    ]) {
      await getDb().query("update staff_assignment set status='active',valid_from=null,valid_until=null where person_id=$1", [worker.person.id]);
      await getDb().query(`update staff_assignment set ${change} where person_id=$1`, [worker.person.id]);
      expect(await taskAssignees(deps, admin, String(request.id))).not.toContainEqual(expect.objectContaining({ id: worker.person.id }));
      await expect(requireTaskAssignee(getDb(), worker.person.id, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    await getDb().query("update staff_assignment set valid_from=null where person_id=$1", [worker.person.id]);
    await expect(requireTaskAssignee(getDb(), worker.person.id, false)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await getDb().query("update person set status='archived' where id=$1", [worker.person.id]);
    expect(await taskAssignees(deps, admin, String(request.id))).not.toContainEqual(expect.objectContaining({ id: worker.person.id }));
    await expect(requireTaskAssignee(getDb(), worker.person.id, true)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("уведомление назначенному сотруднику другого дома разрешено до снятия назначения или отзыва всех ролей", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    await getDb().query("update staff_assignment set role='finance' where person_id=$1", [worker.person.id]);
    await getDb().query("update staff_scope set building_id=$2 where assignment_id in (select id from staff_assignment where person_id=$1)", [worker.person.id, SEED.building2]);
    const task = await createTask(deps, admin, input, "task");
    const actor = (await recipientActor(getDb(), worker.person.id))!;
    const notice = { taskId: task.id, audience: "personal" as const, isTest: true, buildingIds: [SEED.building1] };
    expect(await noticeAllowed(getDb(), actor, notice)).toBe(true);
    await transitionTask(deps, admin, task.id, { action: "reassign", version: task.version, reason: "Замена" }, "remove");
    expect(await noticeAllowed(getDb(), actor, notice)).toBe(false);
    const assigned = await transitionTask(deps, admin, task.id, { action: "assign", version: task.version + 1, assignee_person_id: worker.person.id }, "assign");
    expect(await noticeAllowed(getDb(), actor, notice)).toBe(true);
    await getDb().query("update staff_assignment set status='revoked' where person_id=$1", [worker.person.id]);
    const revoked = (await recipientActor(getDb(), worker.person.id))!;
    expect(await listTasks(deps, revoked)).toHaveLength(0);
    expect(await noticeAllowed(getDb(), revoked, notice)).toBe(false);
    await expect(transitionTask(deps, revoked, task.id, { action: "accept", version: assigned.version }, "revoked"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("регулярное задание назначается дежурному другого дома и повторно проверяет сотрудника при запуске", async () => {
    const { deps, admin, worker } = await setupTasks(getDb());
    await getDb().query("update staff_assignment set role='duty' where person_id=$1", [worker.person.id]);
    await getDb().query("update staff_scope set building_id=$2 where assignment_id in (select id from staff_assignment where person_id=$1)", [worker.person.id, SEED.building2]);
    const template = await saveTemplate(deps, admin, null, {
      name: "Осмотр", title: "Осмотр", instruction: "Осмотреть", buildings: [SEED.building1], required_evidence: [],
    }, "template");
    expect((await scheduleView(deps, admin, String(template.id))).assignees).toContainEqual(expect.objectContaining({ id: worker.person.id, roles: ["duty"] }));
    await saveSchedule(deps, admin, String(template.id), {
      enabled: true, next_run_at: new Date(Date.now() - 60000).toISOString(), interval_hours: 24, due_hours: 8,
      version: 0, assignee_person_id: worker.person.id,
    });
    await enqueueSchedules(deps, new Date(), Date.now() + 120000);
    await processScheduledJobs(deps, Date.now() + 120000);
    expect(await listTasks(deps, (await recipientActor(getDb(), worker.person.id))!)).toContainEqual(expect.objectContaining({ assignee_person_id: worker.person.id, state: "awaiting_acceptance" }));
    await getDb().query("update job_schedule set next_run_at=now()-interval '1 minute'");
    await enqueueSchedules(deps, new Date(), Date.now() + 120000);
    await getDb().query("update staff_assignment set status='revoked' where person_id=$1", [worker.person.id]);
    await processScheduledJobs(deps, Date.now() + 120000);
    expect(await getDb().query("select id from task")).toHaveLength(1);
    expect(await getDb().query("select state from job_queue where state<>'done'")).toContainEqual({ state: "queued" });
  });
});
