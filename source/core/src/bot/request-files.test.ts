import { renderNotice } from "../templates/notice.ts";
import { afterEach, expect, it, vi } from "vitest";
import type { DbClient, DbExecutor } from "../db/client.ts";
import { SqlAuditRepo } from "../domains/audit/repo.ts";
import type { FileStorage } from "../domains/requests/files.ts";
import { processRequestUploads } from "./request-files.ts";
function fixture(attempts = 0, loseLease = false) {
  const job = {
    attachment_id: "file",
    telegram_file_id: "telegram-file",
    person_id: "person",
    bucket: "resident",
    storage_path: "request/file",
    size_bytes: 4,
    mime: "application/pdf",
    filename: "test.pdf",
    attempts,
  };
  let state = "queued",
    attachment = "incomplete",
    stored: Uint8Array | undefined;
  const notifications: (string | { ru: string; kk: string })[] = [];
  const db: DbClient = {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      let rows: unknown[] = [];
      if (sql.startsWith("select j.*")) {
        rows = state === "queued" ? [{ ...job }] : [];
      } else if (sql.includes("set state='processing'")) {
        state = "processing";
        job.attempts++;
        rows = [{ attempts: job.attempts }];
      } else if (sql.includes("set state='complete',lease_until")) {
        if (!loseLease && params[1] === job.attempts) {
          state = "complete";
          rows = [{ attachment_id: "file" }];
        }
      } else if (sql.startsWith("update attachment")) attachment = "complete";
      else if (sql.includes("last_error='FILE_TRANSFER_FAILED'")) {
        state = job.attempts >= 3 ? "failed" : "queued";
        rows = [{ attachment_id: "file" }];
      } else if (sql.startsWith("insert into outbox")) {
        const notice=JSON.parse(String(params[0]));
        const value=notice.template ? notice : notice.text;
        notifications.push({ru:renderNotice(value,"ru"),kk:renderNotice(value,"kk")});
      }
      return rows as T[];
    },
    transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(db),
    close: () => Promise.resolve(),
  };
  const storage: FileStorage = {
    put: (_b, _p, bytes) => {
      stored = bytes;
      return Promise.resolve();
    },
    info: () =>
      stored
        ? Promise.resolve({ size: stored.length, mime: "application/pdf" })
        : Promise.reject(new Error("missing")),
    sign: () => Promise.resolve("unused"),
  };
  return {
    deps: { db, audit: new SqlAuditRepo() },
    storage,
    state: () => state,
    attachment: () => attachment,
    notifications,
  };
}
afterEach(() => vi.unstubAllGlobals());
it("Telegram-файл подтверждается только после переноса и проверки Storage", async () => {
  const f = fixture();
  vi.stubGlobal(
    "fetch",
    (url: string) =>
      Promise.resolve(
        url.endsWith("/getFile")
          ? new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: "documents/file.pdf", file_size: 4 },
            }),
          )
          : new Response(new TextEncoder().encode("%PDF")),
      ),
  );
  expect(
    await processRequestUploads(f.deps, f.storage, {
      resident: "not-a-real-token",
      worker: "not-a-real-token",
    }),
  )
    .toBe(1);
  expect(f.state()).toBe("complete");
  expect(f.attachment()).toBe("complete");
  // Текст уведомления локализуется на доставке по языку профиля.
  expect(f.notifications).toEqual([{ ru: "Файл сохранён", kk: "Файл сақталды" }]);
});
it("ошибка последней попытки оставляет incomplete и предлагает повтор без утечки токена", async () => {
  const f = fixture(2);
  vi.stubGlobal(
    "fetch",
    () => Promise.reject(new Error("secret-token-must-not-leak")),
  );
  await processRequestUploads(f.deps, f.storage, {
    resident: "secret-token-must-not-leak",
    worker: "secret-token-must-not-leak",
  });
  expect(f.state()).toBe("failed");
  expect(f.attachment()).toBe("incomplete");
  expect(f.notifications).toHaveLength(1);
  const notice = f.notifications[0] as { ru: string; kk: string };
  expect(notice.ru).toContain("не сохранён");
  expect(notice.kk).toContain("сақталмады");
  expect(f.notifications.join()).not.toContain("secret-token");
});
it("потерявший lease обработчик не объявляет файл сохранённым", async () => {
  const f = fixture(0, true);
  vi.stubGlobal(
    "fetch",
    (url: string) =>
      Promise.resolve(
        url.endsWith("/getFile")
          ? new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: "documents/file.pdf", file_size: 4 },
            }),
          )
          : new Response(new TextEncoder().encode("%PDF")),
      ),
  );
  await processRequestUploads(f.deps, f.storage, {
    resident: "not-a-real-token",
    worker: "not-a-real-token",
  });
  expect(f.attachment()).toBe("incomplete");
  expect(f.notifications).toEqual([]);
});
