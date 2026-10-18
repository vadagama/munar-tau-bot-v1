import { expect, it, vi } from "vitest";
import { saveVersion } from "./service.ts";
import { makeTestActor } from "../testing/actors.ts";
import type { DbClient } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { AuditEntryInput } from "../domains/audit/port.ts";
import type { Row } from "../domains/registry/validation.ts";
function fixture() {
  let versions: Row[] = [];
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
      if (sql.startsWith("select id from message_template")) {
        result = [{ id: "template" }];
      } else if (sql.startsWith("select * from message_template_version")) {
        result = sql.includes("and version=")
          ? versions.filter((v) => v.version === p[1])
          : versions.slice(-1);
      } else if (sql.startsWith("insert into message_template_version")) {
        const row = {
          id: crypto.randomUUID(),
          version: p[1],
          text_ru: p[2],
          text_kk: p[3],
          use_default: p[4],
          reason: p[5],
          created_by: p[6],
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
