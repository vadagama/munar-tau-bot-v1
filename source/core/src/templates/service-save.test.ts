import { expect, it, vi } from "vitest";
import { saveVersion } from "./service.ts";
import { makeTestActor } from "../testing/actors.ts";
import type { DbClient } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { AuditEntryInput } from "../domains/audit/port.ts";
import type { Row } from "../domains/registry/validation.ts";
function fixture() {
  let versions: Row[] = [];
  let templateKey = "";
  let idem = new Map<string, Row>();
  const entries: AuditEntryInput[] = [];
  const db: DbClient = {
    close: async () => {},
    transaction: async (fn) => {
      const snapshot = [...versions], old = new Map(idem), n = entries.length;
      try {
        return await fn(db);
      } catch (e) {
        versions = snapshot;
        idem = old;
        entries.splice(n);
        throw e;
      }
    },
    query: async <T>(sql: string, p: readonly unknown[] = []) => {
      let result: unknown[] = [];
      if (sql.startsWith("insert into message_template(key)")) {
        templateKey = String(p[0]);
      } else if (sql.startsWith("select t.key,v.text_ru")) {
        result = versions.slice(-1).map((v) => ({
          ...v,
          key: templateKey,
          historical_buttons: versions.filter((h) => !h.use_default).map(
            (h) => ({ ru: h.buttons_ru ?? {}, kk: h.buttons_kk ?? {} }),
          ),
        }));
      } else if (sql.startsWith("select id from message_template")) {
        result = [{ id: "template" }];
      } else if (sql.startsWith("select * from message_template_version")) {
        result = sql.includes("and version=")
          ? versions.filter((v) => v.version === p[1])
          : versions.slice(-1);
      } else if (sql.startsWith("insert into message_template_version")) {
        if (p[4]) {
          expect(p[7]).toBeNull();
          expect(p[8]).toBeNull();
        }
        const row = {
          id: crypto.randomUUID(),
          version: p[1],
          text_ru: p[2],
          text_kk: p[3],
          use_default: p[4],
          reason: p[5],
          created_by: p[6],
          buttons_ru: JSON.parse(String(p[7])),
          buttons_kk: JSON.parse(String(p[8])),
        };
        versions.push(row);
        result = [row];
      } else if (sql.startsWith("select request_hash,response")) {
        result = idem.has(String(p[0])) ? [idem.get(String(p[0]))] : [];
      } else if (sql.startsWith("insert into idempotency_key")) {
        idem.set(String(p[0]), {
          request_hash: p[2],
          response: JSON.parse(String(p[3])),
        });
      }
      return result as T[];
    },
  };
  const append = vi.fn(async (_exec: unknown, value: AuditEntryInput) => {
    entries.push(value);
    return { ...value, id: entries.length, at: "now" };
  });
  const deps = { db, audit: { append } } as unknown as RegistryDeps;
  return { deps, append, entries, versions: () => versions };
}
const actor = makeTestActor("administrator", []), key = "errors.INTERNAL";
it("версии, конфликт, откат-копия и сброс сохраняют исходную историю", async () => {
  const f = fixture();
  const a = await saveVersion(f.deps, actor, key, {
    text_ru: "Один",
    text_kk: "Бір",
    reason: "Первый",
    base_version: 0,
  }, "one");
  expect(a.version.version).toBe(1);
  await expect(
    saveVersion(f.deps, actor, key, {
      text_ru: "Два",
      text_kk: "Екі",
      reason: "Конфликт",
      base_version: 0,
    }, "stale"),
  ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
  await saveVersion(f.deps, actor, key, {
    text_ru: "Два",
    text_kk: "Екі",
    reason: "Второй",
    base_version: 1,
  }, "two");
  const rollback = await saveVersion(f.deps, actor, key, {
    rollback_to: 1,
    reason: "Вернуть первый",
    base_version: 2,
  }, "back");
  expect(rollback.version).toMatchObject({
    version: 3,
    text_ru: "Один",
    text_kk: "Бір",
  });
  const reset = await saveVersion(f.deps, actor, key, {
    use_default: true,
    reason: "Кодовый текст",
    base_version: 3,
  }, "reset");
  expect(reset.version).toMatchObject({
    version: 4,
    text_ru: null,
    text_kk: null,
    use_default: true,
  });
  expect(f.versions()).toHaveLength(4);
  expect(f.entries).toHaveLength(4);
  expect(f.entries[0]).toMatchObject({
    action: "settings.templates.edit",
    actorPersonId: actor.person.id,
  });
});
it("повтор идемпотентен; другое тело не создаёт версию; ошибка аудита откатывает запись", async () => {
  const f = fixture(),
    body = {
      text_ru: "Один",
      text_kk: "Бір",
      reason: "Первый",
      base_version: 0,
    };
  const first = await saveVersion(f.deps, actor, key, body, "same");
  expect(await saveVersion(f.deps, actor, key, body, "same")).toEqual(first);
  expect(f.versions()).toHaveLength(1);
  await expect(
    saveVersion(f.deps, actor, key, { ...body, reason: "Другой" }, "same"),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  f.append.mockRejectedValueOnce(new Error("audit unavailable"));
  await expect(
    saveVersion(f.deps, actor, key, { ...body, base_version: 1 }, "audit"),
  ).rejects.toThrow("audit unavailable");
  expect(f.versions()).toHaveLength(1);
});

it("подписи кнопок сохраняются/откатываются атомарно с текстом", async () => {
  const f = fixture(), key = "message.requests.choose_place";
  await saveVersion(f.deps, actor, key, {
    text_ru: "Выберите: {premises}",
    text_kk: "{premises}",
    buttons_ru: { place: "Место {number}" },
    buttons_kk: { place: "{number}" },
    reason: "Подписи",
    base_version: 0,
  }, "buttons1");
  await saveVersion(f.deps, actor, key, {
    text_ru: "Новый {premises}",
    text_kk: "{premises}",
    buttons_ru: { place: "Другое {number}" },
    reason: "Другие",
    base_version: 1,
  }, "buttons2");
  const restored = await saveVersion(f.deps, actor, key, {
    rollback_to: 1,
    reason: "Вернуть",
    base_version: 2,
  }, "buttons3");
  expect(restored.version.buttons_ru).toEqual({ place: "Место {number}" });
  expect(restored.version.text_ru).toBe("Выберите: {premises}");
  const reset = await saveVersion(f.deps, actor, key, {
    use_default: true,
    reason: "Дефолт",
    base_version: 3,
  }, "buttons4");
  expect(reset.version.buttons_ru).toBeNull();
});

it("новая версия меню не может переиспользовать старую подпись для другого действия", async () => {
  const f = fixture(), key = "help.welcome_text";
  await saveVersion(f.deps, actor, key, {
    text_ru: "Первый",
    text_kk: "Бір",
    buttons_ru: { newrequest: "Подать заявку" },
    reason: "Начальная подпись",
    base_version: 0,
  }, "menu1");
  await saveVersion(f.deps, actor, key, {
    text_ru: "Второй",
    text_kk: "Екі",
    buttons_ru: { newrequest: "Создать обращение" },
    reason: "Новая подпись",
    base_version: 1,
  }, "menu2");
  await expect(
    saveVersion(f.deps, actor, key, {
      text_ru: "Третий",
      text_kk: "Үш",
      buttons_ru: { requests: "Подать заявку" },
      reason: "Попытка другого действия",
      base_version: 2,
    }, "menu3"),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(f.versions()).toHaveLength(2);
  await saveVersion(f.deps, actor, key, {
    use_default: true,
    reason: "Сброс",
    base_version: 2,
  }, "menu-reset");
  await expect(
    saveVersion(f.deps, actor, key, {
      text_ru: "Снова",
      text_kk: "Қайта",
      buttons_ru: { requests: "Подать заявку" },
      reason: "После сброса",
      base_version: 3,
    }, "menu4"),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(f.versions()).toHaveLength(3);
});
