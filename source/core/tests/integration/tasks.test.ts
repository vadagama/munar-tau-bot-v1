import { setupTasks as setup } from "./tasks-helpers.ts";
import { transitionRequest } from "../../src/domains/requests/service.ts";
import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { applyMigrations } from "./helpers.ts";
import {
  createTask,
  getTask,
  transitionTask,
} from "../../src/domains/tasks/service.ts";
describeWithDb("VS-4 задания: SQL/PDP/повторы", (getDb) => {
  it("повтор создания один; исполнитель принимает явно; конкурентная запись — 409", async () => {
    const { deps, admin, worker, input } = await setup(getDb());
    const [a, b] = await Promise.all([
      createTask(deps, admin, input, "create"),
      createTask(deps, admin, input, "create"),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.state).toBe("awaiting_acceptance");
    await expect(
      transitionTask(deps, worker, a.id, {
        action: "start",
        version: a.version,
      }, "start"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const accepted = await transitionTask(deps, worker, a.id, {
      action: "accept",
      version: a.version,
    }, "accept");
    expect(accepted.state).toBe("accepted");
    expect(
      (await transitionTask(deps, worker, a.id, {
        action: "accept",
        version: a.version,
      }, "accept")).version,
    ).toBe(accepted.version);
    await expect(
      transitionTask(deps, worker, a.id, {
        action: "start",
        version: a.version,
      }, "stale"),
    ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    expect(await getDb().query("select id from task")).toHaveLength(1);
    expect(await getDb().query("select id from task_log")).toHaveLength(2);
    expect(
      await getDb().query(
        "select id from notification where channel='telegram'",
      ),
    ).toHaveLength(0);
  });
  it("приостановка/переназначение сохраняют срок, начало и историю; отзыв доступа действует и на replay", async () => {
    const { deps, admin, worker, input, request } = await setup(getDb());
    let t = await createTask(deps, admin, input, "create");
    t = await transitionTask(deps, worker, t.id, {
      action: "accept",
      version: t.version,
    }, "accept");
    t = await transitionTask(deps, worker, t.id, {
      action: "start",
      version: t.version,
    }, "start");
    expect(t.started_at).not.toBeNull();
    expect(
      (await getDb().query(
        "select work_execution_required from request where id=$1",
        [request.id],
      ))[0]?.work_execution_required,
    ).toBe(true);
    const due = t.due_at;
    t = await transitionTask(deps, admin, t.id, {
      action: "suspend",
      version: t.version,
      reason: "Ожидаем деталь",
      next_action: "Получить деталь",
      next_action_at: "2026-11-01T10:00:00Z",
    }, "pause");
    expect(t.prev_state).toBe("in_progress");
    t = await transitionTask(deps, admin, t.id, {
      action: "resume",
      version: t.version,
      reason: "Деталь получена",
    }, "resume");
    expect(t.state).toBe("in_progress");
    t = await transitionTask(deps, admin, t.id, {
      action: "reassign",
      version: t.version,
      reason: "Замена исполнителя",
    }, "reassign");
    expect(t.due_at).toEqual(due);
    expect(t.started_at).not.toBeNull();
    await expect(getTask(deps, worker, t.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      transitionTask(
        deps,
        worker,
        t.id,
        { action: "accept", version: 1 },
        "accept",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDb().query("delete from task_log where task_id=$1", [t.id]))
      .rejects.toThrow(/append-only/);
  });
  it("отмена обращения останавливает локальное задание, сохраняя обязательный объём", async () => {
    const { deps, worker, admin, input, request } = await setup(getDb());
    const t = await createTask(deps, admin, input, "task");
    await transitionRequest(deps, worker, String(request.id), {
      action: "cancel_request",
      expected_version: request.version,
      reason: "Работа больше не нужна",
    });
    expect(
      (await getDb().query("select state,is_required from task where id=$1", [
        t.id,
      ]))[0],
    ).toMatchObject({ state: "canceled", is_required: true });
  });
  it("миграции повторяемы, клиентские роли не получают таблицы VS-4", async () => {
    await applyMigrations(getDb());
    const rows = await getDb().query<
      { relname: string; relrowsecurity: boolean; allowed: boolean }
    >(`select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') as allowed
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('task','task_log','task_report','visit','common_work','common_work_request','job_template','job_template_version','common_work_log')`);
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.relrowsecurity && !r.allowed)).toBe(true);
  });
});
