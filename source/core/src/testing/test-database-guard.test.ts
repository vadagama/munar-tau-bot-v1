import { afterEach, expect, it, vi } from "vitest";
import {
  acquireTestDatabaseLock,
  testDatabaseUrl,
} from "../../tests/integration/helpers.ts";
const previous = process.env.TEST_DATABASE_URL;
afterEach(() => {
  if (previous === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = previous;
});
it("очистка Frankfurt блокируется до подключения", () => {
  process.env.TEST_DATABASE_URL =
    "postgres://postgres:not-a-secret@db.ohpjqsudibkcymjjuedy.supabase.co:5432/postgres";
  expect(() => testDatabaseUrl()).toThrow("fuwsmewtmxmzttwkbdex");
});
it("разрешён только session pooler тестового проекта", () => {
  const session =
    "postgres://postgres.fuwsmewtmxmzttwkbdex:not-a-secret@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres";
  process.env.TEST_DATABASE_URL = session;
  expect(testDatabaseUrl()).toBe(session);
  process.env.TEST_DATABASE_URL = session.replace(":5432/", ":6543/");
  expect(() => testDatabaseUrl()).toThrow("session pooler");
});

it("занятая БД ожидается короткими попытками без запуска тестов", async () => {
  vi.useFakeTimers();
  let available = false, acquired = false;
  const exec = {
    query: <T>() => Promise.resolve([{ acquired: available }] as T[]),
  };
  try {
    const waiting = acquireTestDatabaseLock(exec).then(() => {
      acquired = true;
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(acquired).toBe(false);
    available = true;
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
    expect(acquired).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
