import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask, transitionTask } from "../../src/domains/tasks/service.ts";
import { proposeVisit, updateVisit } from "../../src/domains/tasks/visits.ts";
describeWithDb("VS-4 WRK-03–05 визиты", (getDb) => {
  it("визит подтверждает действующий житель; снятая связь закрывает подтверждение", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(
      deps,
      admin,
      { ...input, access_required: true },
      "create",
    );
    await getDb().query("update task set state='accepted' where id=$1", [t.id]);
    await expect(
      transitionTask(
        deps,
        worker,
        t.id,
        { action: "start", version: 1 },
        "start",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const v = await proposeVisit(deps, worker, {
      task_id: t.id,
      interval_start: new Date(Date.now() + 86400000).toISOString(),
      interval_end: new Date(Date.now() + 90000000).toISOString(),
      note: "Доступ к крану",
    }, "visit");
    await expect(
      updateVisit(
        deps,
        admin,
        String(v.id),
        { action: "confirm", version: 1 },
        "confirm-admin",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const confirmed = await updateVisit(deps, worker, String(v.id), {
      action: "confirm",
      version: 1,
    }, "confirm");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_by_kind).toBe("author");
    await getDb().query(
      "update connection set status='revoked' where person_id=$1",
      [worker.person.id],
    );
    await expect(
      updateVisit(
        deps,
        worker,
        String(v.id),
        { action: "confirm", version: 1 },
        "confirm",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("нет доступа — отдельное событие; состояние задания и исходный интервал сохраняются", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, input, "create");
    await getDb().query("update task set state='accepted' where id=$1", [t.id]);
    const [visit] = await getDb().query(
      `insert into visit(task_id,interval_start,interval_end,status,confirmed_by_person,confirmed_by_kind,created_by)
   values ($1,now()-interval '1 hour',now()+interval '1 hour','confirmed',$2,'author',$2) returning *`,
      [t.id, worker.person.id],
    );
    const v = await updateVisit(deps, worker, String(visit!.id), {
      action: "no_access",
      version: 1,
      reason: "Дверь закрыта",
      contact_attempts: "Два звонка",
      occurred_at: new Date().toISOString(),
    }, "no-access");
    expect(v.interval_start).toEqual(visit!.interval_start);
    expect(v.status).toBe("confirmed");
    expect(
      (await getDb().query("select state from task where id=$1", [t.id]))[0]
        ?.state,
    ).toBe("accepted");
    const [log] = await getDb().query(
      "select meta from task_log where task_id=$1 and meta->>'action'='no_access'",
      [t.id],
    );
    expect(log!.meta).toMatchObject({
      contact_attempts: "Два звонка",
      confirmed_violation: false,
    });
  });
  it("сообщение жителя о неявке не устанавливает нарушение до проверки администратора", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, input, "create");
    const [visit] = await getDb().query(
      `insert into visit(task_id,interval_start,interval_end,status,confirmed_by_person,confirmed_by_kind,created_by)
   values ($1,now()-interval '2 hours',now()-interval '1 hour','confirmed',$2,'author',$2) returning *`,
      [t.id, worker.person.id],
    );
    const body = {
      action: "no_show",
      version: 1,
      reason: "Исполнитель не пришёл",
    };
    await expect(
      updateVisit(deps, admin, String(visit!.id), body, "staff-no-show"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateVisit(deps, worker, String(visit!.id), body, "no-show");
    const [reported] = await getDb().query(
      "select meta from task_log where task_id=$1 and meta->>'action'='no_show'",
      [t.id],
    );
    expect(reported!.meta).toMatchObject({ confirmed_violation: false });
    await expect(
      updateVisit(deps, worker, String(visit!.id), {
        action: "review_no_show",
        version: 2,
        reason: "Проверено",
        confirmed_violation: true,
      }, "worker-review"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateVisit(deps, admin, String(visit!.id), {
      action: "review_no_show",
      version: 2,
      reason: "Созвонились с обеими сторонами",
      confirmed_violation: true,
    }, "review");
    const [review] = await getDb().query(
      "select meta from task_log where task_id=$1 and meta->>'action'='review_no_show'",
      [t.id],
    );
    expect(review!.meta).toMatchObject({ confirmed_violation: true });
    expect(
      (await getDb().query("select state from task where id=$1", [t.id]))[0]
        ?.state,
    ).toBe("awaiting_acceptance");
  });
});
