// Журнал регистраций человека (REG-02a, решение владельца 24.10.2026):
// история изменения статусов анкет по клику на заявителя в кабинете.

import { expect, it } from "vitest";
import type { Actor } from "../../pdp/types.ts";
import type { DbClient, DbExecutor } from "../../db/client.ts";
import type { AuditRepo } from "../audit/port.ts";
import { registrationJournal } from "./journal.ts";
import type { Row } from "../registry/validation.ts";

const actor: Actor = {
  person: {
    id: "admin",
    fullName: "Администратор",
    status: "active",
    isTest: false,
  },
  profile: { id: "profile", personId: "admin", language: "ru", isTest: false },
  assignments: [
    {
      id: "a",
      role: "administrator",
      scopeBuildingIds: ["building"],
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
    },
  ],
  emulation: null,
};

interface Fake {
  person?: Row[];
  profile?: Row[];
  registrations?: Row[];
  events?: Row[];
}
function harness(fake: Fake = {}) {
  const queries: { query: string; params: readonly unknown[] | undefined }[] = [];
  const exec: DbExecutor = {
    query: <T>(query: string, params?: readonly unknown[]) => {
      queries.push({ query, params: params ? [...params] : undefined });
      if (query.startsWith("select id,full_name,phone_e164,is_test from person"))
        return Promise.resolve((fake.person ?? []) as T[]);
      if (query.startsWith("select telegram_user_id from profile"))
        return Promise.resolve((fake.profile ?? []) as T[]);
      if (query.startsWith("select r.id,r.person_id"))
        return Promise.resolve((fake.registrations ?? []) as T[]);
      if (query.startsWith("select a.at,a.action"))
        return Promise.resolve((fake.events ?? []) as T[]);
      return Promise.reject(new Error(`неожиданный запрос: ${query}`));
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  const audit: AuditRepo = {
    append: () => Promise.reject(new Error("журнал не пишет аудит")),
    list: () => Promise.reject(new Error("unused")),
  };
  return { deps: { db, audit }, queries };
}

const person = {
  id: "person-1",
  full_name: "Лего Легович",
  phone_e164: "+77054933569",
  is_test: false,
};

it("журнал запрещён без права registration.review", async () => {
  const h = harness();
  await expect(
    registrationJournal(h.deps, { ...actor, assignments: [] }, "person-1"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.queries).toHaveLength(0);
});

it("журнал: человек не найден или из другого test-режима — NOT_FOUND", async () => {
  const h = harness();
  await expect(registrationJournal(h.deps, actor, "person-1")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const h2 = harness({ person: [{ ...person, is_test: true }] });
  await expect(registrationJournal(h2.deps, actor, "person-1")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("журнал возвращает человека, все анкеты и события статусов", async () => {
  const registrations: Row[] = [
    {
      id: "main",
      person_id: "person-1",
      telegram_user_id: "100",
      premises_id: null,
      role: null,
      source: "bot",
      state: "approved",
      version: 2,
      superseded_by: null,
      created_at: "2026-10-20T10:00:00Z",
      updated_at: "2026-10-23T20:42:00Z",
      decided_at: "2026-10-23T20:42:00Z",
      decided_reason: null,
      withdrawn_at: null,
      full_name: "Лего Легович",
      phone_e164: "+77054933569",
      kind: null,
      number: null,
      building_code: null,
    },
    {
      id: "attach",
      person_id: "person-1",
      telegram_user_id: "100",
      premises_id: "p4",
      role: "owner",
      source: "bot",
      state: "approved",
      version: 1,
      superseded_by: null,
      created_at: "2026-10-23T21:09:00Z",
      updated_at: "2026-10-23T21:09:00Z",
      decided_at: "2026-10-23T21:09:00Z",
      decided_reason: null,
      withdrawn_at: null,
      full_name: "Лего Легович",
      phone_e164: "+77054933569",
      kind: "apartment",
      number: "4",
      building_code: "Д1",
    },
  ];
  const events: Row[] = [
    {
      at: "2026-10-23T21:09:00Z",
      action: "registration.approve",
      before: '{"state":"pending_review"}',
      after: '{"state":"approved","person_id":"person-1"}',
      reason: "Подтверждено по реестру",
      actor_name: "Администратор ОСИ",
    },
  ];
  const h = harness({
    person: [person],
    profile: [{ telegram_user_id: "100" }],
    registrations,
    events,
  });
  const journal = await registrationJournal(h.deps, actor, "person-1");
  expect(journal.person).toEqual({
    id: "person-1",
    full_name: "Лего Легович",
    phone_e164: "+77054933569",
  });
  expect(journal.registrations.map((r) => r.id)).toEqual(["main", "attach"]);
  // JSONB-строки аудита разобраны в объекты для UI.
  expect(journal.events[0]!.after).toEqual({ state: "approved", person_id: "person-1" });
  expect(journal.events[0]!.before).toEqual({ state: "pending_review" });
  expect(journal.events[0]!.actor_name).toBe("Администратор ОСИ");
  // Отбор: по человеку и Telegram активного профиля, в test-режиме актора,
  // с ограничением области администратора.
  const list = h.queries.find((q) => q.query.startsWith("select r.id,r.person_id"))!;
  expect(list.params).toEqual(["person-1", "100", false, ["building"]]);
  const auditQuery = h.queries.find((q) => q.query.startsWith("select a.at,a.action"))!;
  expect(auditQuery.params).toEqual([["main", "attach"]]);
});

it("журнал техадминистратора читает без ограничения области, анкеты без событий — без запроса аудита", async () => {
  const techAdmin: Actor = {
    ...actor,
    assignments: [
      {
        id: "a",
        role: "tech_admin",
        scopeBuildingIds: [],
        financialRights: false,
        registryExportRights: false,
        regulationsRights: false,
      },
    ],
  };
  const h = harness({ person: [person], registrations: [] });
  const journal = await registrationJournal(h.deps, techAdmin, "person-1");
  const list = h.queries.find((q) => q.query.startsWith("select r.id,r.person_id"))!;
  expect(list.params![3]).toBeNull();
  expect(journal.registrations).toEqual([]);
  expect(journal.events).toEqual([]);
  expect(h.queries.some((q) => q.query.startsWith("select a.at,a.action"))).toBe(false);
});
