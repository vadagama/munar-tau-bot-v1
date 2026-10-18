/**
 * Модульные тесты регистрационного сценария бота: /fix (простое исправление
 * анкеты после уточнения), регрессия /edit НОМЕР (резолв ссылки до очистки
 * состояния), guard /register при существующей анкете и /delete (PRV-02).
 * SQL имитируется по префиксам запросов — как в
 * domains/registrations/service.test.ts.
 */
import { describe, expect, it } from "vitest";

import { registrationStep } from "./registration.ts";
import { replyText } from "./keyboard.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";

const REG_ID = "11111111-1111-1111-1111-111111111111";
const REG_ID_2 = "22222222-2222-2222-2222-222222222222";

const ACTIVE_STATES = [
  "pending_review",
  "need_clarification",
  "approved",
  "rejected",
];

function harness(
  opts: {
    registrations?: Row[];
    editable?: Row | null;
    profile?: boolean;
    profileLanguage?: "ru" | "kk";
    personPhone?: string | null;
    /** Связи исходного реестра для списка /add (premises_id, role, kind, number, code). */
    addConnections?: Row[];
    /** Детали выбранной связи для шага add_select. */
    selectedConnection?: Row | null;
    openPrivacyRequests?: Row[];
  } = {},
) {
  const registrations = opts.registrations ?? [];
  const audit: Row[] = [];
  const prefs: unknown[][] = [];
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
      // /status (все анкеты) и guard /register (только действующие состояния):
      // guard-запрос различается по фильтру состояний в SQL.
      if (sql.startsWith("select r.id,r.state,r.decided_reason")) {
        const rows = sql.includes("'approved'")
          ? registrations.filter((r) => ACTIVE_STATES.includes(String(r.state)))
          : registrations;
        return Promise.resolve(rows as T[]);
      }
      if (
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
          (registrations.length
            ? [{ draft: registrations[0]!.draft }]
            : []) as T[],
        );
      // PRV-02: запрос удаления анкеты (сервис privacy).
      if (sql.startsWith("select id from privacy_request"))
        return Promise.resolve((opts.openPrivacyRequests ?? []) as T[]);
      // Мастер регистрации: список зданий для шага выбора.
      if (sql.startsWith("select id,code from building"))
        return Promise.resolve([
          { id: "b1", code: "Ж1" },
        ] as T[]);
      // Шаг «номер помещения»: одно активное помещение.
      if (sql.startsWith("select id from premises"))
        return Promise.resolve([{ id: "p1" }] as T[]);
      if (sql.startsWith("insert into privacy_request"))
        return Promise.resolve([
          { id: "prq-1", person_id: params![0], kind: params![1], state: "received" },
        ] as T[]);
      if (sql.startsWith("insert into notification_pref")) {
        prefs.push(params!);
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("select distinct p.building_id from connection"))
        return Promise.resolve([] as T[]);
      if (sql.startsWith("select distinct a.person_id from staff_assignment"))
        return Promise.resolve([] as T[]);
      if (opts.profile) {
        // Минимальная цепочка actorForTelegram: связь профиль→персона,
        // сам профиль, персона. Назначения (роли) — пусто по умолчанию.
        if (sql.startsWith("select pr.id from profile pr join person")) {
          return Promise.resolve([{ id: "prof-1" }] as T[]);
        }
        if (sql.startsWith("select id, person_id, telegram_user_id")) {
          return Promise.resolve([{
            id: "prof-1",
            person_id: "pers-1",
            telegram_user_id: 100,
            supabase_user_id: null,
            language: opts.profileLanguage ?? "ru",
            is_test: false,
            archived_at: null,
          }] as T[]);
        }
        if (sql.startsWith("select id, full_name, phone_e164")) {
          return Promise.resolve([{
            id: "pers-1",
            full_name: "Тест Тестов",
            phone_e164: null,
            status: "active",
            is_test: false,
            comment: null,
          }] as T[]);
        }
        // /add: телефон и связи исходного реестра предзаполнения анкеты.
        if (sql.startsWith("select phone_e164 from person")) {
          return Promise.resolve([
            { phone_e164: opts.personPhone === undefined ? "+77771234567" : opts.personPhone },
          ] as T[]);
        }
        if (sql.startsWith("select c.premises_id")) {
          return Promise.resolve((opts.addConnections ?? []) as T[]);
        }
        if (sql.startsWith("select c.role")) {
          return Promise.resolve(
            (opts.selectedConnection ? [opts.selectedConnection] : []) as T[],
          );
        }
      }
      // actorForTelegram, bot_dialog, статус доставки, язык профиля и прочее — пусто.
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
    queries,
    audit,
    prefs,
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
    expect(replyText(nameReply)).toContain("Телефон");
    // Согласие — один язык и кнопка с текстовым эквивалентом «да».
    const phoneText = replyText(phoneReply);
    expect(phoneText).toContain("Олег Краснов");
    expect(phoneText).toContain("Согласие на обработку");
    expect(typeof phoneReply === "object" && phoneReply.buttons?.[0]?.[0]?.data).toBe("да");
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
    expect(replyText(list)).toContain("Уточните имя");
    expect(h.state.status_options).toEqual([REG_ID]);
    const reply = await registrationStep(h.deps, "100", "/edit 1");
    expect(replyText(reply)).toContain("язык");
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

describe("бот: /register при существующей анкете (guard)", () => {
  it("approved — актуальный статус вместо мастера регистрации", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "approved",
          draft,
          premises_id: "p1",
          role: "owner",
          kind: "apartment",
          number: "12",
          code: "Ж1",
        },
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/register");
    const text = replyText(reply);
    expect(text).toContain("Вы уже зарегистрированы. Повторная регистрация не нужна.");
    expect(text).toContain("Oleg Krasnov");
    expect(text).toContain("Квартира Ж1/12");
    expect(h.state.step).toBeUndefined();
  });

  it("анкета на проверке — «уже есть анкета» и подсказки /status и /fix", async () => {
    const h = harness({
      registrations: [
        {
          id: REG_ID,
          state: "pending_review",
          decided_reason: null,
          draft,
          premises_id: "p1",
          role: "resident",
          kind: "apartment",
          number: "12",
          code: "Ж1",
        },
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/register");
    const text = replyText(reply);
    expect(text).toContain("У вас уже есть анкета. Повторная регистрация не нужна.");
    expect(text).toContain("/status");
    expect(text).toContain("/fix");
    expect(text).toContain("/add");
    expect(h.state.step).toBeUndefined();
  });

  it("отозванная анкета не мешает новой регистрации (мастер запускается)", async () => {
    const h = harness({
      registrations: [
        { id: REG_ID, state: "withdrawn", draft, premises_id: "p1", role: "resident" },
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/register");
    expect(replyText(reply)).toContain("язык");
    expect(h.state.step).toBe("language");
  });

  it("анкет нет — мастер регистрации запускается", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/register");
    expect(replyText(reply)).toContain("язык");
    expect(h.state.step).toBe("language");
  });
});

describe("бот: /add — добавление помещения", () => {
  const P1 = "aaaaaaaa-1111-1111-1111-111111111111";
  const P2 = "aaaaaaaa-2222-2222-2222-222222222222";
  const connections = [
    { premises_id: P1, role: "owner", kind: "apartment", number: "12", code: "Ж1" },
    { premises_id: P2, role: "owner", kind: "parking_slot", number: "3", code: "П1" },
  ];

  it("есть связанные помещения — список, анкетные данные предзаполнены, вопросы о языке/имени/телефоне не задаются", async () => {
    const h = harness({ profile: true, addConnections: connections });
    const reply = await registrationStep(h.deps, "100", "/add");
    const text = replyText(reply);
    expect(text).toContain("связанные с вами");
    expect(text).toContain("Квартира Ж1/12 — Собственник");
    expect(text).toContain("Парковочное место П1/3 — Собственник");
    expect(text).not.toContain("Ваше имя");
    expect(text).not.toContain("Телефон");
    expect(h.state.step).toBe("add_select");
    expect(h.state.language).toBe("ru");
    expect(h.state.full_name).toBe("Тест Тестов");
    expect(h.state.phone_e164).toBe("+77771234567");
    expect(h.state.add_options).toEqual([P1, P2]);
  });

  it("язык профиля kk — список и согласие на казахском", async () => {
    const h = harness({
      profile: true,
      profileLanguage: "kk",
      addConnections: [connections[0]!],
      selectedConnection: connections[0]!,
    });
    const reply = await registrationStep(h.deps, "100", "/add");
    expect(replyText(reply)).toContain("ОСИ реестрінде");
    expect(h.state.language).toBe("kk");
    const consent = await registrationStep(h.deps, "100", "1");
    expect(replyText(consent)).toContain("Тексеріңіз");
    expect(replyText(consent)).toContain("Меншік иесі");
  });

  it("выбор номера строки — сводка с помещением и шаг согласия", async () => {
    const h = harness({
      profile: true,
      addConnections: connections,
      selectedConnection: connections[1]!,
    });
    await registrationStep(h.deps, "100", "/add");
    const reply = await registrationStep(h.deps, "100", "2");
    const text = replyText(reply);
    expect(text).toContain("Проверьте");
    expect(text).toContain("Парковочное место П1/3");
    expect(text).toContain("Собственник");
    expect(h.state.step).toBe("consent");
    expect(h.state.premises_id).toBe(P2);
    expect(h.state.kind).toBe("parking_slot");
    expect(h.state.role).toBe("owner");
  });

  it("неверный номер строки — ошибка валидации", async () => {
    const h = harness({ profile: true, addConnections: connections });
    await registrationStep(h.deps, "100", "/add");
    await expect(registrationStep(h.deps, "100", "9")).rejects.toThrow();
  });

  it("нет связанных помещений — сразу выбор здания с предзаполненными данными", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/add");
    expect(replyText(reply)).toContain("Выберите здание");
    expect(h.state.step).toBe("building");
    expect(h.state.full_name).toBe("Тест Тестов");
    expect(h.state.phone_e164).toBe("+77771234567");
    expect(h.state.language).toBe("ru");
  });

  it("кнопка «Ввести вручную» (/add manual) — сразу выбор здания", async () => {
    const h = harness({ profile: true, addConnections: connections });
    const reply = await registrationStep(h.deps, "100", "/add manual");
    expect(replyText(reply)).toContain("Выберите здание");
    expect(h.state.step).toBe("building");
    expect(h.state.add_options).toBeUndefined();
  });

  it("без регистрации — полный мастер: сначала язык", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/add");
    expect(replyText(reply)).toContain("язык");
    expect(h.state.step).toBe("language");
  });
});

describe("бот: короткий /start и шаги анкеты (UX-фиксы)", () => {
  it("/start — короткое приветствие вместо полной справки", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/start");
    const text = replyText(reply);
    expect(text).toContain("/register");
    expect(text).toContain("/help");
    // Полная справка остаётся на /help: там раздел «Обращения».
    expect(text).not.toContain("Доступы собственника");
  });

  it("/help — полная справка", async () => {
    const h = harness();
    expect(replyText(await registrationStep(h.deps, "100", "/help"))).toContain(
      "Доступы собственника",
    );
  });

  it("шаги «Тип помещения» и «Ваша роль» без двойной нумерации", async () => {
    const h = harness();
    await registrationStep(h.deps, "100", "/register");
    await registrationStep(h.deps, "100", "ru");
    await registrationStep(h.deps, "100", "Имя Фамилия");
    await registrationStep(h.deps, "100", "+77010000000");
    // Выбор здания возвращает список типов помещений.
    const kind = replyText(await registrationStep(h.deps, "100", "1"));
    // numbered() нумерует сам; двойного «1. 1.» в списке нет.
    expect(kind).toContain("1. Квартира");
    expect(kind).not.toContain("1. 1.");
    await registrationStep(h.deps, "100", "1"); // тип помещения
    // Ввод номера помещения возвращает список ролей.
    const role = replyText(await registrationStep(h.deps, "100", "1"));
    expect(role).toContain("1. Собственник");
    expect(role).not.toContain("1. 1.");
  });
});

describe("бот: /delete — запрос удаления анкеты (PRV-02) [L394-435]", () => {
  it("без регистрации — подсказка /register, запрос не подаётся", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/delete confirm");
    expect(replyText(reply)).toContain("Сначала регистрация: /register");
    expect(h.audit.length).toBe(0);
  });

  it("без confirm — предупреждение с кнопкой подтверждения, ничего не подаётся", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/delete");
    const text = replyText(reply);
    expect(text).toContain("запрос на удаление анкеты");
    expect(text).toContain("История обращений и операций сохранится");
    expect(typeof reply === "object" && reply.buttons?.[0]?.[0]?.data).toBe(
      "/delete confirm",
    );
    expect(h.audit.length).toBe(0);
  });

  it("confirm — запрос подан, аудит записан, необязательные рассылки отключены", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/delete confirm");
    expect(replyText(reply)).toContain(
      "Запрос на удаление анкеты отправлен администратору",
    );
    expect(h.audit.length).toBe(1);
    expect(h.audit[0]).toMatchObject({ action: "privacy.request" });
    expect(h.state).toEqual({});
    // publication, work.report, request.status — три отключения; mode='off' —
    // литерал SQL, а не параметр.
    expect(
      h.queries.filter((sql) => sql.startsWith("insert into notification_pref"))
        .length,
    ).toBe(3);
    expect(
      h.queries
        .filter((sql) => sql.startsWith("insert into notification_pref"))
        .every((sql) => sql.includes("'off'")),
    ).toBe(true);
  });
});
