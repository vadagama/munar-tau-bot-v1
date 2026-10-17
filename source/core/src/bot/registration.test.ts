/**
 * Модульные тесты регистрационного сценария бота: /fix (простое исправление
 * анкеты после уточнения) и регрессия /edit НОМЕР (резолв ссылки до очистки
 * состояния диалога). SQL имитируется по префиксам запросов — как в
 * domains/registrations/service.test.ts.
 */
import { describe, expect, it } from "vitest";

import { registrationStep } from "./registration.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";

const REG_ID = "11111111-1111-1111-1111-111111111111";
const REG_ID_2 = "22222222-2222-2222-2222-222222222222";

function harness(opts: { registrations?: Row[]; editable?: Row | null } = {}) {
  const registrations = opts.registrations ?? [];
  let current: Row = {};
  const queries: string[] = [];
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      queries.push(sql);
      if (sql.startsWith("select state from bot_dialog"))
        return Promise.resolve([{ state: current }] as T[]);
      if (sql.startsWith("update bot_dialog")) {
        current = JSON.parse(String(params![1])) as Row;
        return Promise.resolve([] as T[]);
      }
      if (
        sql.startsWith(
          "select id,state,decided_reason,review_stage from registration",
        ) ||
        sql.includes(
          "state in ('need_clarification','rejected','pending_review') and total_due_at is null",
        )
      )
        return Promise.resolve(registrations as T[]);
      if (sql.startsWith("select id from registration where id=$1"))
        return Promise.resolve(
          opts.editable === undefined || opts.editable === null
            ? []
            : [opts.editable as T],
        );
      if (sql.startsWith("select draft from registration"))
        return Promise.resolve(
          registrations.length ? [{ draft: registrations[0]!.draft }] : [],
        );
      return Promise.resolve([] as T[]);
    },
  };
  const db: DbClient = {
    ...exec,
    transaction: (fn) => fn(exec),
    close: () => Promise.resolve(),
  };
  return {
    deps: { db, audit: {} } as unknown as RegistryDeps,
    queries,
    get state(): Row {
      return current;
    },
  };
}

const draft = {
  full_name: "Oleg Krasnov",
  phone_e164: "+77771234567",
  language: "ru",
  consent: true,
  terms_version: "registration-v1",
};

describe("бот: исправление анкеты (/fix)", () => {
  it("единственная анкета с уточнением — вопрос администратора и шаг fix_name с предзаполнением", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          decided_reason: "Нужно на русском имя и фамилия",
          draft,
          premises_id: "p1",
          role: "resident",
        },
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/fix");
    expect(reply).toContain("Нужно на русском имя и фамилия");
    expect(reply).toContain("имя и фамилию");
    expect(h.state.step).toBe("fix_name");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.language).toBe("ru");
    expect(h.state.premises_id).toBe("p1");
    expect(h.state.role).toBe("resident");
    expect(h.state.status_options).toBeUndefined();
  });

  it("полный проход: новые имя и телефон, сводка и шаг согласия", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          decided_reason: "Уточните имя",
          draft,
          premises_id: "p1",
          role: "resident",
        },
      ],
    });
    await registrationStep(h.deps, "100", "/fix");
    const nameReply = await registrationStep(h.deps, "100", "Олег Краснов");
    expect(h.state.full_name).toBe("Олег Краснов");
    expect(h.state.step).toBe("fix_phone");
    const phoneReply = await registrationStep(h.deps, "100", "8 777 123 45 67");
    expect(h.state.phone_e164).toBe("+77771234567");
    expect(h.state.step).toBe("consent");
    expect(nameReply).toContain("Телефон");
    expect(phoneReply).toContain("Олег Краснов");
    expect(phoneReply).toContain("да / иә");
  });

  it("точка сохраняет прежние имя и телефон из анкеты", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          decided_reason: "Уточните имя",
          draft,
          premises_id: "p1",
          role: "resident",
        },
      ],
    });
    await registrationStep(h.deps, "100", "/fix");
    await registrationStep(h.deps, "100", ".");
    expect(h.state.step).toBe("fix_phone");
    expect(h.state.full_name).toBe("Oleg Krasnov");
    await registrationStep(h.deps, "100", ".");
    expect(h.state.step).toBe("consent");
    expect(h.state.phone_e164).toBe("+77771234567");
  });

  it("несколько анкет — нумерованный список без изменения состояния, выбор по номеру", async () => {
    const h = harness({
      // Порядок как в выдаче SQL: need_clarification приоритетнее rejected.
      registrations: [
        {
          id: REG_ID_2,
          state: "need_clarification",
          decided_reason: "Уточните имя",
          draft,
          premises_id: "p2",
          role: "owner",
        },
        {
          id: REG_ID,
          state: "rejected",
          decided_reason: "Отказ",
          draft,
          premises_id: "p1",
          role: "resident",
        },
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/fix");
    expect(reply).toContain("Уточните имя");
    expect(reply).toContain("Отказ");
    expect(reply).toContain("/fix НОМЕР");
    expect(h.state.step).toBeUndefined();
    await registrationStep(h.deps, "100", "/fix 2");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.step).toBe("fix_name");
  });

  it("редактируемых анкет нет — подсказка /register", async () => {
    const h = harness({ registrations: [] });
    const reply = await registrationStep(h.deps, "100", "/fix");
    expect(reply).toContain("/register");
    expect(h.state.step).toBeUndefined();
  });

  it("номер вне списка — ошибка валидации", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          decided_reason: "Уточните имя",
          draft,
          premises_id: "p1",
          role: "resident",
        },
      ],
    });
    await expect(
      registrationStep(h.deps, "100", "/fix 5"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("бот: /edit НОМЕР после /status (регрессия)", () => {
  it("номер строки из /status резолвится до очистки состояния", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          decided_reason: "Уточните имя",
          review_stage: "administrator",
        },
      ],
      editable: { id: REG_ID },
    });
    const list = await registrationStep(h.deps, "100", "/status");
    expect(list).toContain("Уточните имя");
    expect(h.state.status_options).toEqual([REG_ID]);
    const reply = await registrationStep(h.deps, "100", "/edit 1");
    expect(reply).toContain("язык");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.step).toBe("language");
  });

  it("чужая или нечитаемая анкета — NOT_FOUND", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "need_clarification",
          review_stage: "administrator",
        },
      ],
      editable: null,
    });
    await registrationStep(h.deps, "100", "/status");
    await expect(registrationStep(h.deps, "100", "/edit 1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
