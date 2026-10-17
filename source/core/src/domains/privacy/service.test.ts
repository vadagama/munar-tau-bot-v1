/**
 * Модульные тесты PRV-02 (запрос удаления профиля): повторный открытый запрос
 * отклоняется, необязательные рассылки отключаются сразу, администраторы
 * получают одно уведомление (worker-бот), аудит — append-only запись.
 */
import { describe, expect, it } from "vitest";

import { submitPrivacyRequest } from "./service.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { RegistryDeps } from "../registry/service.ts";
import type { Row } from "../registry/validation.ts";
import type { Actor } from "../../pdp/types.ts";

const actor: Actor = {
  person: { id: "p1", fullName: "Тест Тестов", status: "active", isTest: false },
  profile: { id: "pr1", personId: "p1", language: "ru", isTest: false },
  assignments: [],
  emulation: null,
};

function harness(opts: { open?: Row[]; buildings?: string[] } = {}) {
  const audit: Row[] = [];
  const outbox: Row[] = [];
  const prefs: unknown[][] = [];
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.startsWith("select id from privacy_request"))
        return Promise.resolve((opts.open ?? []) as T[]);
      if (sql.startsWith("insert into privacy_request"))
        return Promise.resolve([
          { id: "prq-1", person_id: params![0], kind: params![1], state: "received" },
        ] as T[]);
      if (sql.startsWith("insert into notification_pref")) {
        prefs.push(params!);
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("select distinct p.building_id from connection"))
        return Promise.resolve(
          (opts.buildings ?? ["b1"]).map((building_id) => ({ building_id })) as T[],
        );
      if (sql.startsWith("select distinct a.person_id from staff_assignment"))
        return Promise.resolve([{ person_id: "admin-1" }] as T[]);
      if (sql.startsWith("insert into outbox")) {
        outbox.push({ payload: JSON.parse(String(params![0])) as Row });
        return Promise.resolve([] as T[]);
      }
      return Promise.resolve([] as T[]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  return {
    deps: {
      db,
      audit: {
        append: (_exec: DbExecutor, input: Row) => {
          audit.push(input);
          return Promise.resolve();
        },
      },
    } as unknown as RegistryDeps,
    audit,
    outbox,
    prefs,
  };
}

describe("submitPrivacyRequest (PRV-02)", () => {
  it("открытый запрос того же вида уже есть — INVALID_TRANSITION", async () => {
    const h = harness({
      open: [{ id: "prq-0", state: "received" }],
    });
    await expect(
      submitPrivacyRequest(h.deps, actor, { kind: "delete_profile" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(h.audit.length).toBe(0);
  });

  it("успех: запрос создан, рассылки отключены, уведомление — worker-боту, аудит записан", async () => {
    const h = harness();
    const row = await submitPrivacyRequest(h.deps, actor, {
      kind: "delete_profile",
    });
    expect(row).toMatchObject({ kind: "delete_profile", state: "received" });
    // publication, work.report, request.status — сразу off (литерал SQL).
    expect(h.prefs.length).toBe(3);
    expect(h.prefs.map((p) => p[1])).toEqual([
      "publication",
      "work.report",
      "request.status",
    ]);
    // Уведомление администратору — в worker-бот, на языке получателя при доставке.
    expect(h.outbox.length).toBe(1);
    const payload = h.outbox[0]!.payload as { bot?: string; isTest?: boolean; text?: Row };
    expect(payload).toMatchObject({ bot: "worker", isTest: false });
    expect(String(payload.text?.ru)).toContain("Тест Тестов");
    expect(h.audit.length).toBe(1);
    expect(h.audit[0]).toMatchObject({
      action: "privacy.request",
      entityType: "privacy_request",
      entityId: "prq-1",
    });
  });

  it("администратор нескольких домов уведомляется один раз", async () => {
    const h = harness({ buildings: ["b1", "b2"] });
    await submitPrivacyRequest(h.deps, actor, { kind: "withdraw_consent" });
    expect(h.outbox.length).toBe(1);
  });
});
