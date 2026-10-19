import { renderNotice } from "../templates/notice.ts";
import { afterEach, expect, it, vi } from "vitest";
import type { DbClient, DbExecutor } from "../db/client.ts";
import { SqlAuditRepo } from "../domains/audit/repo.ts";
import type { FileStorage } from "../domains/requests/files.ts";
import { processRequestUploads, queueRequestFile } from "./request-files.ts";
import { replyText } from "./keyboard.ts";
import { t as templateText } from "../templates/store.ts";
import type { Row } from "../domains/registry/validation.ts";
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

/** Харнесс queueRequestFile: минимальная цепочка actorForTelegram и черновик. */
function queueFixture(dialogState: Row) {
  let dialog = dialogState;
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: readonly unknown[]): Promise<T[]> => {
      if (sql.startsWith("select pr.id from profile pr join person"))
        return Promise.resolve([{ id: "prof-1" }] as T[]);
      if (sql.startsWith("select id, person_id, telegram_user_id"))
        return Promise.resolve([{
          id: "prof-1",
          person_id: "pers-1",
          telegram_user_id: 100,
          supabase_user_id: null,
          language: "ru",
          is_test: true,
          archived_at: null,
        }] as T[]);
      if (sql.startsWith("select id, full_name, phone_e164"))
        return Promise.resolve([{
          id: "pers-1",
          full_name: "Тест",
          phone_e164: null,
          status: "active",
          is_test: true,
          comment: null,
        }] as T[]);
      if (sql.startsWith("select distinct p.building_id from connection"))
        return Promise.resolve([] as T[]);
      if (sql.startsWith("select distinct a.person_id from staff_assignment"))
        return Promise.resolve([] as T[]);
      if (sql.startsWith("select state from bot_dialog"))
        return Promise.resolve([{ state: dialog }] as T[]);
      if (sql.startsWith("update bot_dialog set state=")) {
        dialog = JSON.parse(String(params![1])) as Row;
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("select * from request where id=$1"))
        return Promise.resolve([{
          id: "r1",
          author_person_id: "pers-1",
          state: "draft",
          is_test: true,
          building_id: null,
          premises_id: null,
          kind: "request",
          complaint_subject_person_id: null,
          confirmation_version: 1,
          version: 1,
        }] as T[]);
      if (sql.includes("as participant"))
        return Promise.resolve([
          { participant: true, active_author: true },
        ] as T[]);
      if (sql.startsWith("select * from file_policy where singleton"))
        return Promise.resolve([{
          max_bytes: 20 * 1024 * 1024,
          max_per_message: 10,
          extensions: ["jpg", "jpeg", "png", "pdf"],
        }] as T[]);
      if (sql.startsWith("select count(*)::text n from attachment"))
        return Promise.resolve([{ n: "0" }] as T[]);
      return Promise.resolve([] as T[]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
    close: () => Promise.resolve(),
  };
  return {
    deps: { db, audit: new SqlAuditRepo() } as unknown as Parameters<
      typeof queueRequestFile
    >[0],
    state: () => dialog,
  };
}

it("медиа в файловом диалоге переводит шаг в «Хотите добавить ещё?»", async () => {
  const f = queueFixture({
    scenario: "requests",
    draft_id: "r1",
    step: "attachments_wait",
  });
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
  }, 1);
  expect(f.state().step).toBe("attachments_more");
  expect(replyText(reply)).toBe(
    templateText(undefined, "ru", "message.requests.attachments_more"),
  );
  // Кнопки да/нет с текстовыми эквивалентами.
  expect(reply).toMatchObject({
    buttons: [[{ data: "да" }, { data: "нет" }]],
  });
});

it("медиа вне файлового диалога отвечает прежней репликой очереди", async () => {
  const f = queueFixture({ scenario: "requests", draft_id: "r1" });
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
  }, 2);
  expect(f.state().step).toBeUndefined();
  expect(replyText(reply)).toBe(
    templateText(undefined, "ru", "requests.fayl_prinyat_v_ochered_poka_ne_sohranen"),
  );
});
