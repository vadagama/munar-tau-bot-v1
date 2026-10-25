import { expect, it, vi } from "vitest";
import { sendNotifications } from "./jobs.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { AuditRepo } from "../audit/port.ts";
function harness(channel = "telegram", extra: Record<string, unknown> = {}) {
  let delivered = false;
  const updates: unknown[][] = [];
  const exec: DbExecutor = {
    query: <T>(sql: string, params: readonly unknown[] = []) => {
      if (sql.startsWith("select * from notification")) {
        if (delivered) return Promise.resolve([]);
        delivered = true;
        return Promise.resolve([
          {
            id: "n",
            telegram_user_id: "123",
            channel,
            attempts: 0,
            text: "Тест",
            ...extra,
          },
        ] as T[]);
      }
      if (sql.startsWith("select is_test")) return Promise.resolve([]);
      updates.push([...params]);
      return Promise.resolve([]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  const audit: AuditRepo = {
    append: () => Promise.reject(new Error("unused")),
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, updates };
}
it("simulator никогда не отправляет наружу даже после удаления тестового профиля", async () => {
  const h = harness("simulator"),
    sender = vi.fn(() => Promise.resolve());
  expect(await sendNotifications(h.deps, sender)).toBe(1);
  expect(sender).not.toHaveBeenCalled();
});
it("ошибка транспорта не сохраняет URL с токеном бота", async () => {
  const h = harness();
  await sendNotifications(h.deps, () =>
    Promise.reject(new Error("https://api.telegram.org/botSECRET/sendMessage")),
  );
  expect(JSON.stringify(h.updates)).not.toContain("SECRET");
  expect(h.updates.some((p) => p.includes("DELIVERY_FAILED"))).toBe(true);
});
it("429 учитывает retry_after", async () => {
  const h = harness();
  await sendNotifications(h.deps, () =>
    Promise.reject(
      Object.assign(new Error("TELEGRAM_429"), { retryAfter: 120 }),
    ),
  );
  expect(h.updates.some((p) => p[1] === "queued" && Number(p[3]) >= 120)).toBe(
    true,
  );
});
it("блокировка бота немедленно видна как failed", async () => {
  const h = harness();
  await sendNotifications(h.deps, () =>
    Promise.reject(Object.assign(new Error("TELEGRAM_403"), { blocked: true })),
  );
  expect(
    h.updates.some((p) => p[1] === "failed" && p[2] === "BLOCKED_BY_USER"),
  ).toBe(true);
});

it("после доставки жителю синхронизирует меню чата (REG-01/02)", async () => {
  const h = harness("telegram", { bot: "resident" });
  const sync = vi.fn(() => Promise.resolve());
  expect(
    await sendNotifications(h.deps, () => Promise.resolve(), undefined, sync),
  ).toBe(1);
  expect(sync).toHaveBeenCalledWith("123", false);
});

it("меню чата не трогается для simulator и worker-уведомлений", async () => {
  const sim = harness("simulator", { bot: "resident" });
  const syncSim = vi.fn(() => Promise.resolve());
  await sendNotifications(sim.deps, () => Promise.resolve(), undefined, syncSim);
  expect(syncSim).not.toHaveBeenCalled();

  const worker = harness("telegram", { bot: "worker" });
  const syncWorker = vi.fn(() => Promise.resolve());
  await sendNotifications(
    worker.deps,
    () => Promise.resolve(),
    undefined,
    syncWorker,
  );
  expect(syncWorker).not.toHaveBeenCalled();
});

it("сбой синхронизации меню не ломает доставку", async () => {
  const h = harness("telegram", { bot: "resident" });
  const sync = vi.fn(() => Promise.reject(new Error("TELEGRAM_500")));
  expect(
    await sendNotifications(h.deps, () => Promise.resolve(), undefined, sync),
  ).toBe(1);
  expect(h.updates.some((p) => p[1] === "failed" || p[1] === "queued")).toBe(
    false,
  );
});
