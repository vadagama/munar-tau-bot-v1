import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { createTask } from "../../src/domains/tasks/service.ts";
import { taskStep } from "../../src/bot/tasks.ts";
import { requestStep } from "../../src/bot/requests.ts";
import { botScenarios } from "../../src/bot/scenarios.ts";
import { SEED } from "./helpers.ts";
describeWithDb("VS-4 бот исполнителя", (getDb) => {
  it("общий сценарий ведёт отчёт и не отправляет тестовые уведомления в Telegram", async () => {
    const { deps, admin, worker, input } = await setupTasks(getDb());
    const t = await createTask(deps, admin, input, "create");
    await getDb().query(
      "update task set state='in_progress',started_at=now() where id=$1",
      [t.id],
    );
    const step = (text: string) =>
      taskStep(deps, String(SEED.testExecutorTelegramId), text, worker);
    expect(await step(`/pausetask ${t.number} Опасная течь`)).toContain(
      "Выполняется",
    );
    expect(
      (await getDb().query("select state from task where id=$1", [t.id]))[0]
        ?.state,
    ).toBe("in_progress");
    expect(
      (await getDb().query(
        "select reason from task_log where task_id=$1 and meta->>'action'='request_pause'",
        [t.id],
      ))[0]?.reason,
    ).toBe("Опасная течь");
    expect(botScenarios(deps).listIds()).toContain("tasks");
    expect(await step(`/reporttask ${t.number}`)).toContain("объём");
    await step("Заменён кран");
    await step("2026-10-17 12:00");
    await step("Протечка устранена");
    await step("нет");
    expect(await step("/submitreport")).toContain("На проверке");
    expect(
      await getDb().query("select id from task_report where task_id=$1", [
        t.id,
      ]),
    ).toHaveLength(1);
    expect(
      await getDb().query(
        "select id from notification where channel='telegram'",
      ),
    ).toHaveLength(0);
    await requestStep(
      deps,
      String(SEED.testExecutorTelegramId),
      "/requests",
      worker,
    );
    const [dialog] = await getDb().query<{ state: Record<string, unknown> }>(
      "select state from bot_dialog where telegram_user_id=$1",
      [SEED.testExecutorTelegramId],
    );
    expect(dialog!.state.scenario).toBe("requests");
    expect(dialog!.state.request_id).toBeUndefined();
  });
});
