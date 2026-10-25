import { renderNotice } from "../templates/notice.ts";
import { afterEach, expect, it, vi } from "vitest";
import type { DbClient, DbExecutor } from "../db/client.ts";
import { SqlAuditRepo } from "../domains/audit/repo.ts";
import type { FileStorage } from "../domains/requests/files.ts";
import { processRequestUploads, queueRequestFile } from "./request-files.ts";
import { replyText } from "./keyboard.ts";
import { t as templateText } from "../templates/store.ts";
import type { Row } from "../domains/registry/validation.ts";
function fixture(
  attempts = 0,
  loseLease = false,
  group: { pending?: number; rows?: Row[] } | null = null,
  owner: { request_id?: string; media_group_id?: string | null } | null = null,
) {
  let requestState = "in_work";
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
    ...(group
      ? {
        owner_type: "request",
        owner_id: "r1",
        bot: "resident",
        person_id: "pers-1",
        media_group_id: "G1",
        caption: "фото проблемы",
        request_id: "r1",
      }
      : {}),
    ...(owner
      ? {
        owner_type: "request",
        owner_id: owner.request_id,
        bot: "resident",
        request_id: owner.request_id,
        ...(owner.media_group_id ? { media_group_id: owner.media_group_id } : {}),
      }
      : {}),
  };
  let state = "queued",
    attachment = "incomplete",
    stored: Uint8Array | undefined;
  const notifications: (string | { ru: string; kk: string })[] = [];
  const inserted: { text: unknown; source: unknown }[] = [];
  const reowned: string[] = [];
  const discarded: string[] = [];
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
      } else if (sql.startsWith("update attachment set owner_type=")) {
        reowned.push(...((params[1] ?? []) as string[]));
        rows = ((params[1] ?? []) as string[]).map((id) => ({ id }));
      } else if (sql.startsWith("update attachment set discarded_at")) {
        discarded.push(...((params[0] ?? []) as string[]));
      } else if (sql.startsWith("update attachment set status=")) {
        attachment = "complete";
      } else if (sql.includes("last_error='FILE_TRANSFER_FAILED'")) {
        state = job.attempts >= 3 ? "failed" : "queued";
        rows = [{ attachment_id: "file" }];
      } else if (sql.startsWith("insert into outbox")) {
        const notice=JSON.parse(String(params[0]));
        const value=notice.template ? notice : notice.text;
        notifications.push({ru:renderNotice(value,"ru"),kk:renderNotice(value,"kk")});
      } else if (sql.startsWith("insert into message")) {
        inserted.push({ text: params[4], source: params[7] });
      } else if (
        group &&
        sql.startsWith("select count(*)::text n from request_upload_job")
      ) {
        rows = [{ n: String(group.pending ?? 0) }];
      } else if (group && sql.startsWith("select j.attachment_id,j.caption")) {
        rows = group.rows ?? [];
      } else if (
        sql.startsWith("select state from request where id=$1")
      ) {
        rows = [{ state: requestState }];
      } else if (
        sql.startsWith(
          "select a.status,a.discarded_at from request_upload_job",
        )
      ) {
        rows = group?.rows ?? [];
      } else if (sql.includes("file_policy where singleton")) {
        rows = [{ max_bytes: 1048576, max_per_message: 10, extensions: ["pdf"] }];
      } else if (sql.startsWith("select pr.id from profile pr join person")) {
        rows = [{ id: "prof-1" }];
      } else if (sql.startsWith("select id, person_id, telegram_user_id")) {
        rows = [{
          id: "prof-1",
          person_id: "pers-1",
          telegram_user_id: 100,
          supabase_user_id: null,
          language: "ru",
          is_test: true,
          archived_at: null,
        }];
      } else if (sql.startsWith("select id, full_name, phone_e164")) {
        rows = [{
          id: "pers-1",
          full_name: "Тест",
          phone_e164: null,
          status: "active",
          is_test: true,
          comment: null,
        }];
      } else if (sql.includes("as participant")) {
        rows = [{ participant: true, active_author: true }];
      } else if (sql.startsWith("select * from request where id=$1")) {
        rows = [{ ...OPEN_REQUEST }];
      } else if (sql.startsWith("insert into audit_log")) {
        rows = [{ id: 1, at: "2026-10-25T00:00:00Z" }];
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
    inserted: () => inserted,
    reowned: () => reowned,
    discarded: () => discarded,
    setRequestState: (s: string) => {
      requestState = s;
    },
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

const ALBUM_ROWS = (fileStatus: string): Row[] => [
  {
    attachment_id: "file",
    caption: "фото проблемы",
    created_at: "2026-10-25T10:00:00Z",
    status: fileStatus,
    discarded_at: null,
    request_id: "r1",
  },
  {
    attachment_id: "file2",
    caption: "",
    created_at: "2026-10-25T10:00:01Z",
    status: "complete",
    discarded_at: null,
    request_id: "r1",
  },
];

it("альбом в переписке публикуется одним сообщением после загрузки всех файлов", async () => {
  const f = fixture(0, false, { pending: 0, rows: ALBUM_ROWS("complete") });
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
  expect(f.state()).toBe("complete");
  // Альбом ушёл одним сообщением с подписью и обоими вложениями.
  expect(f.inserted()).toEqual([{ text: "фото проблемы", source: "bot" }]);
  expect(f.reowned()).toEqual(["file", "file2"]);
  // Автор получает только пофайловые подтверждения сохранения.
  expect(f.notifications).toEqual([
    { ru: "Файл сохранён", kk: "Файл сақталды" },
  ]);
});

it("альбом ждёт остальные файлы группы и не публикуется раньше времени", async () => {
  const f = fixture(0, false, { pending: 1, rows: [] });
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
  expect(f.state()).toBe("complete");
  expect(f.inserted()).toEqual([]);
  expect(f.reowned()).toEqual([]);
});

it("безнадёжный файл альбома списывается, остальные публикуются", async () => {
  const f = fixture(2, false, { pending: 0, rows: ALBUM_ROWS("incomplete") });
  vi.stubGlobal(
    "fetch",
    () => Promise.reject(new Error("secret-token-must-not-leak")),
  );
  await processRequestUploads(f.deps, f.storage, {
    resident: "secret-token-must-not-leak",
    worker: "secret-token-must-not-leak",
  });
  expect(f.state()).toBe("failed");
  expect(f.discarded()).toEqual(["file"]);
  expect(f.inserted()).toEqual([{ text: "фото проблемы", source: "bot" }]);
  expect(f.reowned()).toEqual(["file2"]);
  const notice = f.notifications[0] as { ru: string; kk: string };
  expect(notice.ru).toContain("не сохранён");
  expect(f.notifications.join()).not.toContain("secret-token");
});

const WIZARD_OK = async (url: string) =>
  Promise.resolve(
    url.endsWith("/getFile")
      ? new Response(
        JSON.stringify({
          ok: true,
          result: { file_path: "documents/file.pdf", file_size: 4 },
        }),
      )
      : new Response(new TextEncoder().encode("%PDF")),
  );

it("файл мастера: единственная сводка вместо пофайлового «Файл сохранён»", async () => {
  const f = fixture(0, false, null, { request_id: "r1", media_group_id: null });
  f.setRequestState("draft");
  vi.stubGlobal("fetch", WIZARD_OK);
  await processRequestUploads(f.deps, f.storage, {
    resident: "not-a-real-token",
    worker: "not-a-real-token",
  });
  expect(f.state()).toBe("complete");
  expect(f.notifications).toEqual([
    {
      ru: templateText(undefined, "ru", "notices.bot_request-files_process_request_uploads_103"),
      kk: templateText(undefined, "kk", "notices.bot_request-files_process_request_uploads_103"),
    },
  ]);
});

it("отказ файла мастера: прежний текст с отказом, без утечки токена", async () => {
  const f = fixture(2, false, null, { request_id: "r1", media_group_id: null });
  f.setRequestState("draft");
  vi.stubGlobal("fetch", () => Promise.reject(new Error("secret-token-must-not-leak")));
  await processRequestUploads(f.deps, f.storage, {
    resident: "secret-token-must-not-leak",
    worker: "secret-token-must-not-leak",
  });
  expect(f.state()).toBe("failed");
  expect(f.notifications).toHaveLength(1);
  const notice = f.notifications[0] as { ru: string; kk: string };
  expect(notice.ru).toContain("не сохранён");
  expect(notice.kk).toContain("сақталмады");
});

it("альбом мастера: одна сводная реплика после загрузки всей группы", async () => {
  const f = fixture(0, false, { pending: 0, rows: ALBUM_ROWS("complete") }, { request_id: "r1" });
  f.setRequestState("draft");
  vi.stubGlobal("fetch", WIZARD_OK);
  await processRequestUploads(f.deps, f.storage, {
    resident: "not-a-real-token",
    worker: "not-a-real-token",
  });
  expect(f.state()).toBe("complete");
  // Альбом по-прежнему уходит одним сообщением на черновик, сводка дополняет его.
  expect(f.inserted()).toEqual([{ text: "фото проблемы", source: "bot" }]);
  expect(f.notifications).toEqual([
    {
      ru: templateText(undefined, "ru", "notices.bot_request-files_process_request_uploads_104", { count: 2 }),
      kk: templateText(undefined, "kk", "notices.bot_request-files_process_request_uploads_104", { count: 2 }),
    },
  ]);
});

it("частичный сбой альбома мастера: одна сводка «N из M» вместо пофайловых отказов", async () => {
  const f = fixture(2, false, { pending: 0, rows: ALBUM_ROWS("incomplete") }, { request_id: "r1" });
  f.setRequestState("draft");
  vi.stubGlobal("fetch", () => Promise.reject(new Error("secret-token-must-not-leak")));
  await processRequestUploads(f.deps, f.storage, {
    resident: "secret-token-must-not-leak",
    worker: "secret-token-must-not-leak",
  });
  expect(f.state()).toBe("failed");
  expect(f.discarded()).toEqual(["file"]);
  expect(f.inserted()).toEqual([{ text: "фото проблемы", source: "bot" }]);
  expect(f.notifications).toEqual([
    {
      ru: templateText(undefined, "ru", "notices.bot_request-files_process_request_uploads_105", { count: 1, total: 2 }),
      kk: templateText(undefined, "kk", "notices.bot_request-files_process_request_uploads_105", { count: 1, total: 2 }),
    },
  ]);
  expect(f.notifications.join()).not.toContain("secret-token");
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
      if (sql.startsWith("update bot_dialog_channel set state=")) {
        dialog = JSON.parse(String(params![1])) as Row;
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("select * from request where id=$1"))
        return Promise.resolve([{ ...OPEN_REQUEST }] as T[]);
      if (sql.includes("as participant"))
        return Promise.resolve([
          { participant: true, active_author: true },
        ] as T[]);
      if (sql.startsWith("update attachment set owner_type='message'"))
        return Promise.resolve(
          ((params?.[1] ?? []) as string[]).map((id) => ({ id })) as T[],
        );
      if (sql.startsWith("insert into audit_log"))
        return Promise.resolve([{
          id: 1,
          at: "2026-10-25T00:00:00Z",
          actor_person_id: "pers-1",
          actor_profile_id: "prof-1",
          emulation_session_id: null,
          emulated_person_id: null,
          action: "request.message",
          entity_type: "request",
          entity_id: "r1",
          before: null,
          after: null,
          reason: null,
          scope_buildings: "[]",
          meta: "{}",
        }] as T[]);
      if (sql.includes("file_policy where singleton"))
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
    transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(db),
    close: () => Promise.resolve(),
  };
  return {
    deps: { db, audit: new SqlAuditRepo() } as unknown as Parameters<
      typeof queueRequestFile
    >[0],
    state: () => dialog,
    baseQuery: exec.query,
  };
}

it("медиа в файловом диалоге подтверждается молча — сводку пришлёт джоба", async () => {
  const f = queueFixture({
    scenario: "requests",
    draft_id: "r1",
    step: "attachments_wait",
  });
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
  }, 1);
  // Шаг нормализуется в «attachments»; реплика с кнопками уходит из джобы
  // после переноса файла, вебхук молчит (25.10.2026).
  expect(f.state().step).toBe("attachments");
  expect(replyText(reply)).toBe("");
});

it("медиа черновика вне файлового шага тоже подтверждается молча", async () => {
  const f = queueFixture({ scenario: "requests", draft_id: "r1" });
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
  }, 2);
  expect(f.state().step).toBeUndefined();
  expect(replyText(reply)).toBe("");
});
/** Активная переписка (PR #111): приглашение «Написать» по открытому обращению. */
const SAY_DIALOG: Row = {
  scenario: "requests",
  request_id: "r1",
  input_form: {
    token: "t1",
    command: "/say",
    object_id: "r1",
    number: "З-1",
    version: 1,
    title: "Написать сообщение",
    fields: ["text"],
    values: [],
    index: 0,
    confirm_command: "/rinput",
    cancel_command: "/request З-1",
  },
};
const OPEN_REQUEST: Row = {
  id: "r1",
  author_person_id: "pers-1",
  state: "in_work",
  is_test: true,
  building_id: null,
  premises_id: null,
  kind: "request",
  complaint_subject_person_id: null,
  confirmation_version: 1,
  version: 1,
  number: "З-1",
};

it("скрепка в переписке (/say): одиночное фото уходит сообщением и возвращает карточку", async () => {
  const f = queueFixture(structuredClone(SAY_DIALOG));
  const query = vi.spyOn(f.deps.db, "query");
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
  }, 5);
  const insert = query.mock.calls.find(([sql]) =>
    sql.startsWith("insert into message")
  );
  expect(insert).toBeDefined();
  // Вложение переносится в сообщение в той же транзакции.
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("update attachment set owner_type='message'")
    ),
  ).toBe(true);
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("insert into request_upload_job")
    ),
  ).toBe(true);
  // Ответ — обновлённая карточка обращения, как после текстового сообщения.
  expect(replyText(reply)).toContain("З-1");
  // Форма закрыта: следующий текст не отправит второе сообщение невзначай.
  expect(f.state().input_form).toBeUndefined();
});

it("скрепка в переписке: альбом принимается в очередь без немедленной публикации", async () => {
  const f = queueFixture(structuredClone(SAY_DIALOG));
  const query = vi.spyOn(f.deps.db, "query");
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f1", file_size: 100, width: 1, height: 1 }],
    media_group_id: "G1",
    caption: "фото проблемы",
  }, 6);
  const job = query.mock.calls.find(([sql]) =>
    sql.startsWith("insert into request_upload_job")
  );
  expect(job).toBeDefined();
  expect(job?.[1]).toContain("G1");
  expect(job?.[1]).toContain("фото проблемы");
  // Сообщение собирает джоба после загрузки материалов — сразу не публикуем.
  expect(
    query.mock.calls.some(([sql]) => sql.startsWith("insert into message")),
  ).toBe(false);
  expect(replyText(reply)).toBe(
    templateText(undefined, "ru", "message.requests.media_queued"),
  );
  expect(reply).toMatchObject({
    buttons: [[{ data: "/request З-1" }]],
  });
  // Форма остаётся активной: следующий текст уйдёт сообщением.
  expect(f.state().input_form).toBeDefined();
});

it("скрепка в переписке: второй и следующие файлы альбома подтверждаются молча", async () => {
  const f = queueFixture(structuredClone(SAY_DIALOG));
  const query = vi.spyOn(f.deps.db, "query");
  query.mockImplementation((sql: string, params?: readonly unknown[]) => {
    if (
      sql.startsWith(
        "select 1 from request_upload_job where person_id=$1 and media_group_id=$2",
      )
    ) return Promise.resolve([{ ok: 1 }] as never);
    return (
      f.baseQuery as (
        sql: string,
        params?: readonly unknown[],
      ) => Promise<unknown[]>
    )(sql, params);
  });
  const reply = await queueRequestFile(f.deps, "100", {
    photo: [{ file_id: "f2", file_size: 100, width: 1, height: 1 }],
    media_group_id: "G1",
  }, 7);
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("insert into request_upload_job")
    ),
  ).toBe(true);
  expect(replyText(reply)).toBe("");
});

it("скрепка при открытом обращении без формы: фото уходит сообщением и возвращает карточку", async () => {
  const f = queueFixture({ scenario: "requests", request_id: "r1" });
  const query = vi.spyOn(f.deps.db, "query");
  const reply = await queueRequestFile(f.deps, "100", {
    document: { file_id: "d1", file_size: 100, file_name: "акт.pdf", mime_type: "application/pdf" },
  }, 8);
  expect(
    query.mock.calls.some(([sql]) => sql.startsWith("insert into message")),
  ).toBe(true);
  expect(replyText(reply)).toContain("З-1");
});

it.each(["input_form", "visit_form", "visit_context", "share_form"])('non-say media inside %s still asks for text',async(formType)=>{
 const f=queueFixture({scenario:'requests',request_id:'wrong-request',draft_id:'old-draft',[formType]:{command:'/problem',object_id:'correct-request',number:'З-1',cancel_command:'/request З-1'}});
 const query=vi.spyOn(f.deps.db,'query');
 const reply=await queueRequestFile(f.deps,'100',{photo:[{file_id:'f',file_size:100}]},9);
 expect(replyText(reply)).toContain('Введите текст сообщения');
 expect(query.mock.calls.some(([sql])=>sql.startsWith('insert into attachment')||sql.startsWith('insert into message')||sql.startsWith('insert into request_upload_job'))).toBe(false);
});

it.each(['input_form','visit_form','visit_context','share_form'])('media inside %s cannot publish to a previously opened request',async(formType)=>{
 const f=queueFixture({scenario:'requests',request_id:'wrong-request',draft_id:'old-draft',[formType]:{command:'/other',object_id:'correct-request',number:'З-1',cancel_command:'/request З-1'}});
 const query=vi.spyOn(f.deps.db,'query');
 const reply=await queueRequestFile(f.deps,'100',{photo:[{file_id:'f',file_size:100}]},3);
 expect(replyText(reply)).toContain('Введите текст сообщения');
 expect(query.mock.calls.some(([sql])=>sql.startsWith('insert into attachment')||sql.startsWith('insert into message')||sql.startsWith('insert into request_upload_job'))).toBe(false);
});

it.each(['input_form','visit_form','visit_context'])('worker media inside %s cannot attach to an old task',async(formType)=>{
 const f=queueFixture({scenario:'tasks',task_id:'wrong-task',[formType]:{command:'no_access',object_id:'correct-task',cancel_command:'/task З-2'}});
 const query=vi.spyOn(f.deps.db,'query');
 const reply=await queueRequestFile(f.deps,'100',{photo:[{file_id:'f',file_size:100}]},4,'worker');
 expect(replyText(reply)).toContain('Введите текст сообщения');
 expect(query.mock.calls.some(([sql])=>sql.startsWith('insert into attachment')||sql.startsWith('insert into request_upload_job'))).toBe(false);
});
