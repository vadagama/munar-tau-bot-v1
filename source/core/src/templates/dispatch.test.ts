import { expect, it } from "vitest";
import { dispatchNotices } from "../domains/notifications/service.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbClient } from "../db/client.ts";
it("диспетчер материализует оба формата по языку и читает свежий store на каждый батч", async () => {
  const template = "errors.INTERNAL";
  let language = "kk", custom = "Жаңа", loads = 0;
  const sent: unknown[][] = [];
  const db: DbClient = {
    close: async () => {},
    transaction: (fn) => fn(db),
    query: async <T>(sql: string, p: readonly unknown[] = []) => {
      let rows: unknown[] = [];
      if (sql.startsWith("select id,payload from outbox")) {
        rows = [{
          id: "one",
          payload: { personId: "p", key: "new", template, vars: {} },
        }, {
          id: "two",
          payload: {
            personId: "p",
            key: "old",
            text: { ru: "Старое", kk: "Ескі" },
          },
        }];
      } else if (sql.includes("from message_template t")) {
        loads++;
        rows = [{
          key: template,
          text_ru: "Новый",
          text_kk: custom,
          use_default: false,
        }];
      } else if (sql.startsWith("select p.id from profile")) {
        rows = [{
          id: "profile",
        }];
      } else if (sql.includes("from profile where id =")) {
        rows = [{
          id: "profile",
          person_id: "p",
          language,
          is_test: true,
          archived_at: null,
        }];
      } else if (sql.includes("from person where id =")) {
        rows = [{
          id: "p",
          full_name: "Тест",
          status: "active",
          is_test: true,
        }];
      } else if (sql.startsWith("insert into notification(")) sent.push([...p]);
      return rows as T[];
    },
  };
  const deps = { db } as RegistryDeps;
  expect(await dispatchNotices(deps)).toBe(2);
  expect(sent.map((p) => p[1])).toEqual(["Жаңа", "Ескі"]);
  custom = "Өзгертілді";
  await dispatchNotices(deps);
  expect(sent[2]?.[1]).toBe("Өзгертілді");
  language = "ru";
  await dispatchNotices(deps);
  expect(sent.slice(-2).map((p) => p[1])).toEqual(["Новый", "Старое"]);
  expect(loads).toBe(3);
});

/** Сводка загрузки мастера: кнопки одной строкой, callback_data — точные команды. */
it("сводка загрузки: «Сохранить запрос» → /sendrequest, «В главное меню» → /cancel", async () => {
  const template = "notices.bot_request-files_process_request_uploads_103";
  const sent: unknown[][] = [];
  const db: DbClient = {
    close: async () => {},
    transaction: (fn) => fn(db),
    query: async <T>(sql: string, p: readonly unknown[] = []) => {
      let rows: unknown[] = [];
      if (sql.startsWith("select id,payload from outbox")) {
        rows = [{
          id: "one",
          payload: { personId: "p", key: "k", template, vars: {}, requestId: "r1" },
        }];
      } else if (sql.includes("from message_template t")) {
        rows = [];
      } else if (sql.startsWith("select p.id from profile")) {
        rows = [{ id: "profile" }];
      } else if (sql.includes("from profile where id =")) {
        rows = [{ id: "profile", person_id: "p", language: "ru", is_test: true, archived_at: null }];
      } else if (sql.includes("from person where id =")) {
        rows = [{ id: "p", full_name: "Тест", status: "active", is_test: true }];
      } else if (sql.startsWith("select number from request where id=$1")) {
        rows = [{ number: "З-26-00023" }];
      } else if (sql.startsWith("select * from request where id=$1")) {
        // noticeAllowed: автор читает свой черновик (PDP request.read).
        rows = [{
          id: "r1",
          author_person_id: "p",
          state: "draft",
          is_test: true,
          building_id: null,
          premises_id: null,
          complaint_route: null,
          complaint_subject_person_id: null,
          version: 1,
          number: "З-26-00023",
        }];
      } else if (sql.includes("as participant")) {
        rows = [{ participant: true, active_author: true }];
      } else if (sql.startsWith("insert into notification(")) sent.push([...p]);
      return rows as T[];
    },
  };
  const deps = { db } as RegistryDeps;
  expect(await dispatchNotices(deps)).toBe(1);
  expect(JSON.parse(String(sent[0]?.[11]))).toMatchObject({
    inline_keyboard: [[
      { text: "Сохранить запрос", callback_data: "/sendrequest" },
      { text: "В главное меню", callback_data: "/cancel" },
    ]],
  });
});

/** Отказ переноса файла: без request-разметки достаточно кнопки главного меню. */
it("отказ переноса файла: одна кнопка «В главное меню»", async () => {
  const template = "notices.bot_request-files_process_request_uploads_102";
  const sent: unknown[][] = [];
  const db: DbClient = {
    close: async () => {},
    transaction: (fn) => fn(db),
    query: async <T>(sql: string, p: readonly unknown[] = []) => {
      let rows: unknown[] = [];
      if (sql.startsWith("select id,payload from outbox")) {
        rows = [{
          id: "one",
          payload: { personId: "p", key: "k", template, vars: {} },
        }];
      } else if (sql.includes("from message_template t")) {
        rows = [];
      } else if (sql.startsWith("select p.id from profile")) {
        rows = [{ id: "profile" }];
      } else if (sql.includes("from profile where id =")) {
        rows = [{ id: "profile", person_id: "p", language: "ru", is_test: true, archived_at: null }];
      } else if (sql.includes("from person where id =")) {
        rows = [{ id: "p", full_name: "Тест", status: "active", is_test: true }];
      } else if (sql.startsWith("insert into notification(")) sent.push([...p]);
      return rows as T[];
    },
  };
  const deps = { db } as RegistryDeps;
  await dispatchNotices(deps);
  expect(JSON.parse(String(sent[0]?.[11]))).toMatchObject({
    inline_keyboard: [[
      { text: "В главное меню", callback_data: "/cancel" },
    ]],
  });
});
