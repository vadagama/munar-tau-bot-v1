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
    buildings?: Row[];
    /** Помещения шага «номер помещения»: поиск по номеру/uuid и подсказка. */
    premiseNumbers?: Row[];
    editable?: Row | null;
    profile?: boolean;
    profileLanguage?: "ru" | "kk";
    personPhone?: string | null;
    /** Связи исходного реестра для списка /add (premises_id, role, kind, number, code). */
    addConnections?: Row[];
    /** Детали выбранной связи для шага add_select. */
    selectedConnection?: Row | null;
    /** Анкеты для списка /pending (review_stage='owner'). */
    pendingRows?: Row[];
    /** Анкета для reviewRegistration (select * from registration … for update). */
    reviewRow?: Row | null;
    /** Доступы для списка /accesses. */
    accessRows?: Row[];
    /** Активные приглашения собственника для секции /accesses (id, token, expires_at). */
    inviteRows?: Row[];
    /** Активные приглашённые для /bind (id, full_name). */
    bindPersons?: Row[];
    /** Помещения собственника для шага /bind (premises_id, kind, number, code). */
    bindPremises?: Row[];
    /** Приглашённый для bindResident (id, is_test). */
    invitedPerson?: Row | null;
    /** Активная связь жильца с помещением — блокирует bindResident. */
    bindExisting?: boolean;
    /** Действующий собственник — false имитирует отказ createInvite. */
    isOwner?: boolean;
    /** Приглашение для deep-link (select * from invite … for update). */
    inviteToken?: Row | null;
    /** Создатель приглашения (select is_test from person …). */
    inviteCreator?: Row | null;
    /** Персона актора для acceptInvite (id, is_test, status). */
    personRow?: Row | null;
    /** Помещения для списка /objects (id, premises_id, role, status, kind, number, code). */
    objectsRows?: Row[];
    /** Связь для revokeOwnConnection (select * from connection … for update). */
    revokeRow?: Row | null;
    /** Активные связи персоны для /status и guard /register (premises_id, kind, number, code). */
    personConnections?: Row[];
    openPrivacyRequests?: Row[];
  } = {},
) {
  const registrations = (opts.registrations ?? []).map(row => {
    if (row.version === undefined) row.version = 1;
    return row;
  });
  const audit: Row[] = [];
  const prefs: unknown[][] = [];
  let current: Row = {};
  const queries: string[] = [];
  const paramsList: unknown[][] = [];
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      queries.push(sql);
      paramsList.push(params ? [...params] : []);
      if (sql.startsWith("select state from bot_dialog"))
        return Promise.resolve([{ state: current }] as T[]);
      if (sql.startsWith("update bot_dialog")) {
        current = JSON.parse(String(params![1])) as Row;
        return Promise.resolve([] as T[]);
      }
      // /status (все анкеты) и guard /register (только действующие состояния):
      // guard-запрос различается по фильтру состояний в SQL.
      if (/^select r\.id,r\.state,.*?\sfrom registration r\b/s.test(sql)) {
        const rows = sql.includes("'approved'")
          ? registrations.filter((r) => ACTIVE_STATES.includes(String(r.state)))
          : registrations;
        return Promise.resolve(rows as T[]);
      }
      if (/^select id,state,decided_reason,draft,premises_id,role(?:,version)? from registration\b/.test(sql)) {
        const allowedStates = sql.match(/state in \(([^)]+)\)/)?.[1]
          ?.match(/'([^']+)'/g)?.map((state) => state.slice(1, -1)) ?? [];
        return Promise.resolve(registrations.filter((row) =>
          allowedStates.includes(String(row.state)) && (!row.total_due_at || row.state === "approved")
        ) as T[]);
      }
      if (sql.startsWith("select id,version from registration where telegram_user_id="))
        return Promise.resolve(registrations.filter(row => row.state !== "withdrawn" && !row.superseded_by).slice(0, 1) as T[]);
      if (sql.startsWith("select * from registration where id=$1 and telegram_user_id=$2"))
        return Promise.resolve(registrations.filter(row => row.id === params?.[0]) as T[]);
      // /pending: анкеты на подтверждение собственника.
      if (sql.startsWith("select r.id,r.draft,p.kind,p.number")) {
        return Promise.resolve((opts.pendingRows ?? []) as T[]);
      }
      // reviewRegistration: анкета, помещение и активная связь собственника.
      if (sql.startsWith("select * from registration where id=$1 for update")) {
        return Promise.resolve(
          (opts.reviewRow ? [opts.reviewRow] : []) as T[],
        );
      }
      if (sql.startsWith("select * from premises where id=$1")) {
        return Promise.resolve([
          { id: "p1", is_test: false, building_id: "b1" },
        ] as T[]);
      }
      if (
        sql.startsWith(
          "select id from connection where person_id=$1 and premises_id=$2 and role='owner' and status='active' for update",
        )
      ) {
        return Promise.resolve([{ id: "c1" }] as T[]);
      }
      // /accesses: выданные доступы собственника.
      if (sql.startsWith("select c.id,c.confirmed_by,n.full_name")) {
        return Promise.resolve((opts.accessRows ?? []) as T[]);
      }
      // /accesses: активные приглашения собственника (ADR-020).
      if (sql.startsWith("select i.id,i.token,i.expires_at from invite")) {
        return Promise.resolve((opts.inviteRows ?? []) as T[]);
      }
      // /bind: приглашённые собственника без действующих привязок.
      if (sql.startsWith("select n.id, n.full_name from invite")) {
        return Promise.resolve((opts.bindPersons ?? []) as T[]);
      }
      // /bind: помещения собственника (роль owner в SQL отличает от /status).
      if (
        sql.startsWith("select c.premises_id,p.kind,p.number,b.code from connection c") &&
        sql.includes("c.role='owner'")
      ) {
        return Promise.resolve((opts.bindPremises ?? []) as T[]);
      }
      // createInvite: действующий собственник (ADR-020).
      if (
        sql.startsWith("select id from connection where person_id=$1 and role='owner'")
      ) {
        return Promise.resolve(
          (opts.isOwner === false ? [] : [{ id: "c1" }]) as T[],
        );
      }
      // bindResident: приглашённый должен быть из приглашений актора.
      if (sql.startsWith("select n.id from person n")) {
        return Promise.resolve(
          (opts.invitedPerson === undefined || opts.invitedPerson === null
            ? []
            : [opts.invitedPerson]) as T[],
        );
      }
      // bindResident: действующая связь жильца с помещением.
      if (
        sql.startsWith("select id from connection where person_id=$1 and premises_id=$2 and status='active'")
      ) {
        return Promise.resolve(
          (opts.bindExisting ? [{ id: "c-exists" }] : []) as T[],
        );
      }
      // deep-link: приглашение по токену и его создатель.
      if (sql.startsWith("select * from invite")) {
        return Promise.resolve(
          (opts.inviteToken ? [opts.inviteToken] : []) as T[],
        );
      }
      // acceptInvite: персона актора (по умолчанию активная, is_test=false).
      if (sql.startsWith("select id,is_test,status from person")) {
        return Promise.resolve([
          opts.personRow ?? { id: "pers-1", status: "active", is_test: false },
        ] as T[]);
      }
      if (sql.startsWith("select is_test from person")) {
        return Promise.resolve(
          (opts.inviteCreator ? [opts.inviteCreator] : []) as T[],
        );
      }
      // Уведомление инициатору: профиль создателя приглашения.
      if (sql.startsWith("select pr.telegram_user_id,pr.language from profile")) {
        return Promise.resolve([
          { telegram_user_id: 200, language: "ru" },
        ] as T[]);
      }
      // bindResident и полные данные связи для итогового ответа.
      if (
        sql.startsWith("insert into invite") ||
        sql.startsWith("insert into connection") ||
        sql.startsWith("insert into person") ||
        sql.startsWith("insert into profile")
      ) {
        if (sql.startsWith("insert into invite")) {
          return Promise.resolve([
            {
              id: "invite-1",
              token: "t".repeat(64),
              expires_at: "2026-10-27T10:00:00.000Z",
            },
          ] as T[]);
        }
        if (sql.startsWith("insert into connection")) {
          return Promise.resolve([{ id: "conn-new", person_id: "pers-9" }] as T[]);
        }
        if (sql.startsWith("insert into person")) {
          return Promise.resolve([
            { id: "pers-new", full_name: "Новый Жилец" },
          ] as T[]);
        }
        return Promise.resolve([{ id: "prof-new" }] as T[]);
      }
      if (sql.startsWith("select full_name from person")) {
        return Promise.resolve([{ full_name: "Алия Омарова" }] as T[]);
      }
      if (
        sql.startsWith("select n.full_name,p.kind,p.number,b.code from connection")
      ) {
        return Promise.resolve([
          {
            full_name: "Алия Омарова",
            kind: "apartment",
            number: "4",
            code: "107/1",
          },
        ] as T[]);
      }
      // Активные связи персоны: список помещений в /status и guard /register.
      if (sql.startsWith("select c.premises_id,p.kind,p.number,b.code from connection c")) {
        return Promise.resolve((opts.personConnections ?? []) as T[]);
      }
      // /objects: помещения пользователя; фильтр статуса связи берётся из SQL.
      if (sql.startsWith("select c.id,c.premises_id,c.role")) {
        const rows = opts.objectsRows ?? [];
        return Promise.resolve(
          (sql.includes("c.status='active'")
            ? rows.filter((r) => r.status === "active")
            : rows) as T[],
        );
      }
      // revokeOwnConnection: связь, которую отзывают.
      if (sql.startsWith("select * from connection where id=$1 for update")) {
        return Promise.resolve(
          (opts.revokeRow ? [opts.revokeRow] : []) as T[],
        );
      }
      if (
        sql.startsWith("select id from registration where id=$1") ||
        /^select id,premises_id(?:,version)? from registration where id=\$1/.test(sql)
      )
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
      if (sql.startsWith("select id,code"))
        return Promise.resolve((opts.buildings ?? [
          { id: "b1", code: "Ж1" },
        ]) as T[]);
      // Шаг «номер помещения»: поиск по номеру или uuid из deep-link
      // (params[3] — ввод), а также список для подсказки. ids списка —
      // uuid, иначе ссылки не пройдут регекс premiseChoice при клике.
      if (sql.startsWith("select id,number from premises"))
        return Promise.resolve(
          (opts.premiseNumbers ?? [{ id: "p1", number: "1" }]) as T[],
        );
      if (sql.startsWith("select id from premises")) {
        const input = String(params?.[3] ?? "");
        const found = (opts.premiseNumbers ?? [{ id: "p1", number: "1" }])
          .filter((row) => row.number === input || row.id === input);
        return Promise.resolve(found.map((row) => ({ id: row.id })) as T[]);
      }
      // Шаг «роль»: адрес помещения для согласия (дом, код, номер).
      if (sql.startsWith("select p.number"))
        return Promise.resolve([
          { number: "4", code: "107/2" },
        ] as T[]);
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
      // submitRegistration: таймер этапа и новая анкета.
      if (sql.startsWith("select v.id,v.params from time_rule_version"))
        return Promise.resolve([
          { id: "v1", params: { hours: 12, clock: "calendar" } },
        ] as T[]);
      if (sql.startsWith("insert into timer"))
        return Promise.resolve([{ due_at: "2026-10-20T10:00:00.000Z" }] as T[]);
      if (sql.startsWith("insert into registration"))
        return Promise.resolve([{ id: REG_ID }] as T[]);
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
    paramsList,
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
    expect(phoneText).toContain("Если согласны на обработку");
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
    const text = replyText(reply);
    expect(text).toContain("Какую анкету исправить?");
    expect(text).toContain("Уточните имя");
    expect(text).toContain("Отказ");
    expect(reply).toMatchObject({
      buttons: [
        [{ text: "Исправить — 1", data: "/fix 1" }],
        [{ text: "Исправить — 2", data: "/fix 2" }],
      ],
    });
    expect(h.state.step).toBeUndefined();
    await registrationStep(h.deps, "100", "/fix 2");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.step).toBe("fix_name");
  });

  it("редактируемых анкет нет — подсказка /register", async () => {
    const h = harness({ registrations: [] });
    const reply = await registrationStep(h.deps, "100", "/fix");
    expect(replyText(reply)).toContain("Анкет для исправления нет");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Новая анкета", data: "/register" }]],
    });
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

describe("бот: подтверждение анкет собственником (/pending)", () => {
  const pendingRow = {
    id: REG_ID,
    state: "pending_review",
    review_stage: "owner",
    draft,
    premises_id: "p1",
    role: "tenant",
    kind: "apartment",
    number: "4",
  };

  it("список — заголовок и три решения кнопками, команд в тексте нет", async () => {
    const h = harness({ profile: true, pendingRows: [pendingRow] });
    const reply = await registrationStep(h.deps, "100", "/pending");
    const text = replyText(reply);
    expect(text).toContain("Анкеты на подтверждение:");
    expect(text).not.toContain("/reject");
    expect(reply).toMatchObject({
      buttons: [[
        { text: "Подтвердить — 1", data: "/approve 1" },
        { text: "Отказать — 1", data: "/reject 1" },
        { text: "Спор — 1", data: "/dispute 1" },
      ]],
    });
  });

  it("отказ без причины — вопрос о причине, отмена сбрасывает диалог", async () => {
    const h = harness({ profile: true, pendingRows: [pendingRow] });
    await registrationStep(h.deps, "100", "/pending");
    const reply = await registrationStep(h.deps, "100", "/reject 1");
    expect(replyText(reply)).toContain("Укажите причину одним сообщением");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Отменить", data: "/cancel" }]],
    });
    expect(h.state.step).toBe("reason_prompt");
    expect(h.state.reason_action).toBe("reject");
    expect(h.state.reason_id).toBe(REG_ID);
    await registrationStep(h.deps, "100", "/cancel");
    expect(h.state.step).toBeUndefined();
  });

  it("причина следующим сообщением — решение сохранено, состояние очищено", async () => {
    const h = harness({
      profile: true,
      pendingRows: [pendingRow],
      reviewRow: {
        id: REG_ID,
        is_test: false,
        premises_id: "p1",
        role: "tenant",
        review_stage: "owner",
        state: "pending_review",
        telegram_user_id: 777,
      },
    });
    await registrationStep(h.deps, "100", "/pending");
    await registrationStep(h.deps, "100", "/reject 1");
    const reply = await registrationStep(h.deps, "100", "Не проживаю здесь");
    expect(replyText(reply)).toContain("Решение сохранено");
    expect(h.audit.length).toBe(1);
    expect(h.audit[0]).toMatchObject({ action: "registration.reject" });
    expect(h.state).toEqual({});
  });
});

describe("бот: выданные доступы (/accesses)", () => {
  const accessRow = {
    id: "conn-1",
    confirmed_by: "pers-1",
    full_name: "Алия Омарова",
    kind: "apartment",
    number: "4",
    registration_id: REG_ID,
  };

  it("список — заголовок и две кнопки на доступ, команд в тексте нет", async () => {
    const h = harness({ profile: true, accessRows: [accessRow] });
    const reply = await registrationStep(h.deps, "100", "/accesses");
    const text = replyText(reply);
    expect(text).toContain("Выданные доступы:");
    expect(text).not.toContain("/revoke");
    expect(reply).toMatchObject({
      buttons: [[
        { text: "Прекратить доступ — 1", data: "/revoke 1" },
        { text: "Спор — 1", data: "/dispute 1" },
      ]],
    });
  });

  it("отзыв без причины — вопрос о причине; причина текстом — связь прекращена", async () => {
    const h = harness({
      profile: true,
      accessRows: [accessRow],
      revokeRow: {
        id: "conn-1",
        premises_id: "p1",
        role: "resident",
        confirmed_by: "pers-1",
        status: "active",
        person_id: "pers-2",
      },
    });
    await registrationStep(h.deps, "100", "/accesses");
    const reply = await registrationStep(h.deps, "100", "/revoke 1");
    expect(replyText(reply)).toContain("Укажите причину одним сообщением");
    expect(h.state.step).toBe("reason_prompt");
    expect(h.state.reason_action).toBe("revoke");
    expect(h.state.reason_id).toBe("conn-1");
    const done = await registrationStep(h.deps, "100", "Выехал");
    expect(replyText(done)).toContain("Связь прекращена");
    expect(h.audit.length).toBe(1);
    expect(h.audit[0]).toMatchObject({ action: "connection.revoke" });
    expect(h.state).toEqual({});
  });
});

describe("бот: мои помещения (/objects)", () => {
  const objectRow = (id: string, status: string) => ({
    id,
    premises_id: "p-" + id,
    role: "owner",
    status,
    kind: "apartment",
    number: "4",
    code: "107/1",
  });

  it("список показывает только подтверждённые помещения и кнопку «Добавить помещение»", async () => {
    const h = harness({
      profile: true,
      objectsRows: [
        objectRow("conn-1", "active"),
        objectRow("conn-2", "revoked"),
        objectRow("conn-3", "pending"),
      ],
    });
    const reply = await registrationStep(h.deps, "100", "/objects");
    const text = replyText(reply);
    expect(text).toContain("Мои помещения:");
    // Прекращённая и неподтверждённая связи в список жителя не попадают.
    expect(text).not.toContain("Прекращено");
    expect(text).not.toContain("Не подтверждено");
    expect(reply).toMatchObject({
      buttons: [
        [{ text: "Пригласить", data: "/invite" }],
        [{ text: "Добавить помещение", data: "/add" }],
      ],
    });
  });

  it("без подтверждённых помещений — подсказка о пустом списке и кнопка добавления", async () => {
    const h = harness({
      profile: true,
      objectsRows: [objectRow("conn-2", "revoked")],
    });
    const reply = await registrationStep(h.deps, "100", "/objects");
    const text = replyText(reply);
    expect(text).toContain("Подтверждённых");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Добавить помещение", data: "/add" }]],
    });
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
  it.each(["ru", "kk"] as const)("подтверждённая регистрация без помещений: имя и дата (%s)", async (language) => {
    const h = harness({ profile: true, profileLanguage: language, registrations: [{
      id: REG_ID, state: "approved", draft: { full_name: "<Евгений>" },
      created_at: "2026-10-20T22:30:00.000Z", premises_id: null,
      has_active_premises: false,
    }] });
    const reply = await registrationStep(h.deps, "100", "/register");
    expect(replyText(reply)).toBe(language === "ru"
      ? "Статус анкеты\n&lt;Евгений&gt;, Вы зарегистрированы 21.10.2026 03:30\nПомещения пока не прикреплены\n\nПовторная регистрация не нужна"
      : "Өтінім күйі\n&lt;Евгений&gt;, Сіз 21.10.2026 03:30 күні тіркелдіңіз\nҮй-жайлар әлі байланыстырылмаған\n\nҚайта тіркелудің қажеті жоқ");
    expect(typeof reply !== "string" && reply.buttons?.map(row => row.map(button => button.data)))
      .toEqual([["/status"], ["/fix"], ["/add"], ["/delete"]]);
  });

  it("при действующей привязке показывает список помещений", async () => {
    const h = harness({ registrations: [{ id: REG_ID, state: "approved", draft,
      premises_id: null, person_id: "pers-9", created_at: "2026-10-20T10:00:00Z" }],
      personConnections: [
        { premises_id: "p9", kind: "apartment", number: "4", code: "107/1" },
        { premises_id: "p8", kind: "parking_slot", number: "25", code: "107/1" },
      ] });
    const text = replyText(await registrationStep(h.deps, "100", "/register"));
    expect(text).not.toContain("Помещения пока не прикреплены");
    expect(text).toContain("Прикрепленные помещения:");
    expect(text).toContain("- Дом 107/1, Квартира 4");
    expect(text).toContain("- Дом 107/1, Парковочное место 25");
    expect(text).toContain("Повторная регистрация не нужна");
  });

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
    expect(text).toContain("Дом Ж1, Квартира 12");
    expect(h.state.step).toBeUndefined();
  });

  it("анкета на проверке — «уже есть анкета» и кнопки /status, /fix, /add", async () => {
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
    expect(reply).toMatchObject({
      buttons: [[
        { text: "Статус регистрации", data: "/status" }], [
        { text: "Исправить анкету", data: "/fix" }], [
        { text: "Добавить помещение", data: "/add" }], [
        { text: "Удалить анкету", data: "/delete" },
      ]],
    });
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

  it("анкета-минимум на проверке — guard не даёт начать вторую регистрацию", async () => {
    const h = harness({
      registrations: [{
        id: REG_ID,
        state: "pending_review",
        draft,
        premises_id: null,
        role: null,
      }],
    });
    const reply = await registrationStep(h.deps, "100", "/register");
    expect(replyText(reply)).toContain(
      "У вас уже есть анкета. Повторная регистрация не нужна.",
    );
    expect(replyText(reply)).toContain("помещение не указано");
    expect(h.state.step).toBeUndefined();
  });
});

describe("бот: анкета без помещения (/status, /fix)", () => {
  it("подтверждённая основная анкета: /register → /status → /fix открывает исправление той же анкеты", async () => {
    const h = harness({
      registrations: [{
        id: REG_ID,
        state: "approved",
        decided_reason: null,
        draft,
        premises_id: null,
        role: null,
      }],
    });

    const registered = await registrationStep(h.deps, "100", "/register");
    expect(replyText(registered)).toContain("Вы зарегистрированы");
    expect(h.state.step).toBeUndefined();
    const status = await registrationStep(h.deps, "100", "/status");
    expect(replyText(status)).toContain("Помещения пока не прикреплены");

    const fix = await registrationStep(h.deps, "100", "/fix");
    expect(replyText(fix)).toContain("имя и фамилию");
    expect(h.state.step).toBe("fix_name");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state).not.toHaveProperty("premises_id");
    expect(h.state).not.toHaveProperty("role");

    await registrationStep(h.deps, "100", "Новое имя");
    await registrationStep(h.deps, "100", "+77779876543");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.step).toBe("consent");
    expect(h.state.full_name).toBe("Новое имя");
    expect(h.state.phone_e164).toBe("+77779876543");
    expect(h.queries.some((query) => query.startsWith("insert into registration"))).toBe(false);
  });

  it.each(["ru", "kk"] as const)("кнопочные ответы основной анкеты не дублируют команды (%s)", async (language) => {
    const h = harness({
      profile: true,
      profileLanguage: language,
      registrations: [{
        id: REG_ID,
        state: "approved",
        decided_reason: null,
        draft: { ...draft, language },
        premises_id: null,
        role: null,
      }],
    });
    for (const command of ["/register", "/status"]) {
      const reply = await registrationStep(h.deps, "100", command);
      expect(typeof reply).toBe("object");
      if (typeof reply === "object") {
        expect(reply.buttons?.flat().some((button) => /^\/(fix|edit)(?:\s|$)/.test(button.data))).toBe(true);
        expect(replyText(reply)).not.toMatch(/\/(register|status|fix|edit|add|delete)\b/);
      }
    }
  });

  it("/status показывает анкету без помещения и без роли", async () => {
    const h = harness({
      registrations: [{
        id: REG_ID,
        state: "pending_review",
        decided_reason: null,
        draft,
        premises_id: null,
        role: null,
      }],
    });
    const reply = await registrationStep(h.deps, "100", "/status");
    const text = replyText(reply);
    expect(text).toContain("Oleg Krasnov");
    expect(text).toContain("Ожидает проверки");
    // Основная анкета без помещения — без строки «помещение не указано».
    expect(text).not.toContain("помещение не указано");
  });

  it("/fix на анкете без помещения — premises_id и роль не предзаполняются", async () => {
    const h = harness({
      registrations: [{
        id: REG_ID,
        state: "need_clarification",
        decided_reason: "Уточните имя",
        draft,
        premises_id: null,
        role: null,
      }],
    });
    await registrationStep(h.deps, "100", "/fix");
    expect(h.state.registration_id).toBe(REG_ID);
    expect(h.state.step).toBe("fix_name");
    expect(h.state).not.toHaveProperty("premises_id");
    expect(h.state).not.toHaveProperty("role");
    // Повторная подача: дом и роль не нужны — после телефона сразу согласие.
    await registrationStep(h.deps, "100", ".");
    await registrationStep(h.deps, "100", ".");
    expect(h.state.step).toBe("consent");
  });
});

describe("бот: /status — актуальный статус и история изменений", () => {
  const currentRow = () => ({
    id: REG_ID,
    state: "approved",
    decided_reason: null,
    decided_at: "2026-10-21T10:00:00.000Z",
    created_at: "2026-10-21T09:00:00.000Z",
    draft,
    confirmed_draft: draft,
    person_id: "pers-1",
    premises_id: null,
    role: null,
  });
  const withdrawnRow = () => ({
    id: REG_ID_2,
    state: "withdrawn",
    decided_reason: null,
    decided_at: "2026-10-17T15:19:00.000Z",
    created_at: "2026-10-17T10:00:00.000Z",
    draft,
    premises_id: null,
    role: null,
  });
  const rejectedRow = () => ({
    id: "33333333-3333-3333-3333-333333333333",
    state: "rejected",
    decided_reason: "Нужна латиница в имени",
    decided_at: "2026-10-20T10:00:00.000Z",
    created_at: "2026-10-20T09:00:00.000Z",
    draft,
    premises_id: null,
    role: null,
  });
  // Отдельная анкета привязки помещения — факт привязки, не статус профиля.
  const premiseRow = () => ({
    id: "44444444-4444-4444-4444-444444444444",
    state: "pending_review",
    decided_reason: null,
    decided_at: null,
    created_at: "2026-10-20T12:00:00.000Z",
    draft,
    premises_id: "p1",
    kind: "apartment",
    code: "Ж1",
    number: "1",
    role: "owner",
  });

  it("актуальный статус как в /register, история — только профильные решения", async () => {
    const h = harness({ registrations: [currentRow(), premiseRow(), rejectedRow(), withdrawnRow()] });
    const reply = await registrationStep(h.deps, "100", "/status");
    const text = replyText(reply);
    // Актуальный статус — как в /register: имя, дата и помещения (или их отсутствие).
    expect(text).toContain(
      "Статус анкеты\nOleg Krasnov, Вы зарегистрированы 21.10.2026 14:00\nПомещения пока не прикреплены",
    );
    // История — хронологически, только решения по профилю.
    expect(text).toContain("История изменений статуса:");
    expect(text).toContain("17.10.2026 20:19 — <b>Отозвана</b>: Oleg Krasnov");
    expect(text).toContain(
      "20.10.2026 15:00 — <b>Отказано</b>: Oleg Krasnov — Нужна латиница в имени",
    );
    // Анкеты привязок помещений в историю не попадают.
    expect(text).not.toContain("Дом Ж1");
    expect(text.indexOf("Вы зарегистрированы")).toBeLessThan(text.indexOf("История изменений статуса:"));
    // Операции адресованы только актуальной анкете.
    expect(reply).toMatchObject({
      buttons: [
        [{ text: "Исправить анкету", data: "/edit 1" }],
        [{ text: "Удалить анкету", data: "/delete" }],
      ],
    });
  });

  it("актуальная анкета в споре — кнопки исправления нет, удаление остаётся", async () => {
    const h = harness({ registrations: [{ ...currentRow(), state: "disputed" }, rejectedRow()] });
    const reply = await registrationStep(h.deps, "100", "/status");
    if (typeof reply === "string") throw new Error("Ожидался ответ с кнопками");
    const data = reply.buttons?.flat().map(button => button.data) ?? [];
    expect(data).not.toContain("/edit 1");
    expect(data).toContain("/delete");
    expect(replyText(reply)).toContain("История изменений статуса:");
  });

  it("/cancel после /status очищает диалог и открывает главное меню", async () => {
    const h = harness({ registrations: [currentRow(), rejectedRow()] });
    await registrationStep(h.deps, "100", "/status");
    expect(h.state.status_options).toEqual([REG_ID, "33333333-3333-3333-3333-333333333333"]);
    const reply = await registrationStep(h.deps, "100", "/cancel");
    expect(replyText(reply)).toContain("ОСИ ЖК «Мунар Тау»");
    expect(h.state).toEqual({});
  });

  it("подтверждённая привязка показывается в списке помещений актуального статуса", async () => {
    const h = harness({
      registrations: [currentRow()],
      personConnections: [{ premises_id: "p1", kind: "apartment", number: "4", code: "107/1" }],
    });
    const text = replyText(await registrationStep(h.deps, "100", "/status"));
    expect(text).toContain("Прикрепленные помещения:");
    expect(text).toContain("- Дом 107/1, Квартира 4");
    expect(text).not.toContain("Помещения пока не прикреплены");
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
    expect(text).toContain("Дом Ж1, Квартира 12 — Собственник");
    expect(text).toContain("Дом П1, Парковочное место 3 — Собственник");
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
    expect(text).toContain("Дом П1, Парковочное место 3");
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

  it("нет связанных помещений — сразу номер дома текстом с предзаполненными данными", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/add");
    expect(replyText(reply)).toContain("Напишите номер вашего дома");
    expect(h.state.step).toBe("building");
    expect(h.state.full_name).toBe("Тест Тестов");
    expect(h.state.phone_e164).toBe("+77771234567");
    expect(h.state.language).toBe("ru");
  });

  it("кнопка «Ввести вручную» (/add manual) — сразу номер дома текстом", async () => {
    const h = harness({ profile: true, addConnections: connections });
    const reply = await registrationStep(h.deps, "100", "/add manual");
    expect(replyText(reply)).toContain("Напишите номер вашего дома");
    expect(h.state.step).toBe("building");
    expect(h.state.add_options).toBeUndefined();
  });

  it("без регистрации — сначала базовая регистрация, мастер привязки не запускается", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/add");
    expect(replyText(reply)).toContain("Сначала регистрация");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Зарегистрироваться", data: "/register" }]],
    });
    expect(h.state.step).toBeUndefined();
  });
});

describe("бот: короткий /start и шаги анкеты (UX-фиксы)", () => {
  it.each(["/start", "Старт"])("%s возвращает главное меню и закрывает временную форму", async input => {
    const h = harness();
    await registrationStep(h.deps, "100", "/register");
    await registrationStep(h.deps, "100", "ru");
    expect(h.state.step).toBe("name");
    const reply = await registrationStep(h.deps, "100", input);
    expect(replyText(reply)).toContain("Регистрация, помещения, обращения и уведомления.");
    expect(h.state).toEqual({});
  });

  it("/start — короткое приветствие вместо полной справки", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/start");
    const text = replyText(reply);
    expect(text).toContain("Регистрация, помещения, обращения и уведомления.");
    expect(text).not.toContain("/help");
    // Полная справка остаётся на /help: там раздел «Обращения».
    expect(text).not.toContain("Доступы собственника");
  });

  it("/help — полная справка", async () => {
    const h = harness();
    expect(replyText(await registrationStep(h.deps, "100", "/help"))).toContain(
      "📝 /register — Зарегистрироваться.",
    );
  });

  it("шаги «Тип помещения» и «Ваша роль» показывают варианты только кнопками (привязка через /add manual)", async () => {
    const h = harness({ profile: true });
    await registrationStep(h.deps, "100", "/add manual");
    // Дом вводится кодом текстом: «/», «-» и пробелы равнозначны (REG-11).
    const kind = await registrationStep(h.deps, "100", "ж 1");
    expect(replyText(kind)).toContain("Тип помещения");
    expect(replyText(kind)).not.toContain("Квартира");
    expect(kind).toMatchObject({ buttons: expect.any(Array) });
    expect(typeof kind === "object" && kind.buttons?.flat().some(button => button.text.includes("Квартира"))).toBe(true);
    await registrationStep(h.deps, "100", "1");
    const role = await registrationStep(h.deps, "100", "1");
    expect(replyText(role)).toContain("Ваша роль");
    expect(replyText(role)).not.toContain("Собственник");
    expect(typeof role === "object" && role.buttons?.flat().some(button => button.text.includes("Собственник"))).toBe(true);
  });

  it("номер дома текстом: неизвестный код показывает подсказку", async () => {
    const h = harness({ profile: true });
    await registrationStep(h.deps, "100", "/add manual");
    const again = await registrationStep(h.deps, "100", "999");
    expect(h.state.step).toBe("building");
    expect(h.state.building_id).toBeUndefined();
    expect(replyText(again)).toContain("Дом не найден. Выберите свой дом");
  });

  it("/register — анкета-минимум: язык → имя → телефон → согласие без помещения, подача без premises_id и роли", async () => {
    const h = harness();
    const lang = await registrationStep(h.deps, "100", "/register");
    expect(replyText(lang)).toContain("язык");
    expect(h.state.step).toBe("language");
    await registrationStep(h.deps, "100", "ru");
    await registrationStep(h.deps, "100", "Имя Фамилия");
    const phoneReply = await registrationStep(h.deps, "100", "+7 777 777 16 76");
    // Согласие без помещения: нет вопроса о здании и списков типов/ролей.
    const consent = replyText(phoneReply);
    expect(consent).toContain("Имя Фамилия");
    expect(consent).toContain("+77777771676");
    expect(consent).toContain("Если согласны на обработку");
    expect(consent).not.toContain("Выберите здание");
    expect(h.state.step).toBe("consent");
    const done = await registrationStep(h.deps, "100", "да");
    expect(replyText(done)).toContain("Анкета принята");
    expect(h.state).toEqual({});
    const i = h.queries.findIndex((q) =>
      q.startsWith("insert into registration"),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(h.paramsList[i]![2]).toBeNull(); // premises_id
    expect(h.paramsList[i]![3]).toBeNull(); // role
  });

  it("/register на казахском — согласие без помещения на казахском", async () => {
    const h = harness();
    await registrationStep(h.deps, "100", "/register");
    await registrationStep(h.deps, "100", "kk");
    await registrationStep(h.deps, "100", "Аты Жөні");
    const phoneReply = await registrationStep(h.deps, "100", "+7 701 000 00 00");
    expect(replyText(phoneReply)).toContain("Тексеріңіз");
    expect(replyText(phoneReply)).toContain("ОСИ-де өңдеуге келісетін");
  });
});

describe("бот: /delete — удаление с подтверждением", () => {
  const pending = {
    id: REG_ID, version: 3, state: "pending_review", person_id: null,
    telegram_user_id: "100", is_test: false, premises_id: null, draft,
  };

  it("без анкеты сообщает, что анкет нет", async () => {
    const h = harness();
    const reply = await registrationStep(h.deps, "100", "/delete");
    expect(replyText(reply)).toContain("Анкет пока нет");
    expect(h.state.delete_id).toBeUndefined();
    expect(h.audit).toHaveLength(0);
  });

  it("confirm без предварительного предупреждения запрещён", async () => {
    const h = harness({ registrations: [pending] });
    await expect(registrationStep(h.deps, "100", "/delete confirm"))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(h.audit).toHaveLength(0);
  });

  it("предупреждает о закрытии доступа и сохраняет версию для подтверждения", async () => {
    const h = harness({ registrations: [pending] });
    const reply = await registrationStep(h.deps, "100", "/delete");
    expect(replyText(reply)).toContain("Доступ к боту и кабинету закроется");
    expect(replyText(reply)).toContain("История обращений и операций сохранится");
    expect(replyText(reply)).not.toContain("/delete");
    expect(reply).toMatchObject({ buttons: [[
      { data: "/delete confirm" }, { data: "/cancel" },
    ]] });
    expect(h.state.delete_id).toBe(REG_ID);
    expect(h.state.delete_version).toBe(3);
    expect(h.audit).toHaveLength(0);
  });

  it("заявитель до создания профиля удаляет свою ожидающую анкету", async () => {
    const h = harness({ registrations: [pending] });
    await registrationStep(h.deps, "100", "/delete");
    const reply = await registrationStep(h.deps, "100", "/delete confirm");
    expect(replyText(reply)).toContain("Анкета удалена");
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({ action: "registration.delete", entityId: REG_ID });
    expect(h.queries.some(sql => sql.startsWith("update registration set state='withdrawn'"))).toBe(true);
    expect(h.queries.some(sql => sql.startsWith("insert into privacy_request"))).toBe(false);
    expect(h.state).toEqual({});
  });

  it("отмена закрывает подтверждение и не удаляет анкету", async () => {
    const h = harness({ registrations: [pending] });
    await registrationStep(h.deps, "100", "/delete");
    await registrationStep(h.deps, "100", "/cancel");
    await expect(registrationStep(h.deps, "100", "/delete confirm"))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(h.audit).toHaveLength(0);
    expect(h.queries.some(sql => sql.startsWith("update registration set state='withdrawn'"))).toBe(false);
  });

  it("изменение анкеты после предупреждения требует повторного подтверждения", async () => {
    const changed = { ...pending };
    const h = harness({ registrations: [changed] });
    await registrationStep(h.deps, "100", "/delete");
    changed.version = 4;
    await expect(registrationStep(h.deps, "100", "/delete confirm"))
      .rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    expect(h.audit).toHaveLength(0);
    expect(h.queries.some(sql => sql.startsWith("update registration set state='withdrawn'"))).toBe(false);
  });
});


it("/add: только отмена, при ошибке — дома по очередям, ссылка выбирает дом", async () => {
  const id="00000000-0000-4000-8000-000000000001";
  const h=harness({profile:true,buildings:[{id,code:"102/1",construction_phase:1}]});
  const prompt=await registrationStep(h.deps,"100","/add");
  expect(typeof prompt!=="string"&&prompt.buttons?.flat().map(button=>button.data)).toEqual(["/cancel"]);
  const hints=await registrationStep(h.deps,"100","999/99");
  expect(replyText(hints)).toContain("<b>Очередь 1</b>");
  const link=`/start house_${id}_${h.state.house_choice_token}`;
  expect(replyText(hints)).toContain(`?start=house_${id}_${h.state.house_choice_token}`);
  const result=await registrationStep(h.deps,"100",link);
  expect(h.state.building_id).toBe(id);
  expect(h.state.step).toBe("kind");
  expect(replyText(result)).toContain("Тип помещения");
  const stale=await registrationStep(h.deps,"100",link);
  expect(replyText(stale)).toContain("уже неактивен");
  expect(h.state.step).toBe("kind");
});

it("/add manual: при ошибке — номера помещений ссылками, ссылка выбирает помещение", async () => {
  const pid="aaaaaaaa-0000-4000-8000-000000000004";
  const h=harness({
    profile:true,
    premiseNumbers:[
      {id:pid,number:"4"},
      {id:"aaaaaaaa-0000-4000-8000-000000000005",number:"5"},
      {id:"aaaaaaaa-0000-4000-8000-000000000006",number:"6"},
    ],
  });
  await registrationStep(h.deps,"100","/add manual");
  const kind=await registrationStep(h.deps,"100","ж 1");
  expect(replyText(kind)).toContain("Тип помещения");
  await registrationStep(h.deps,"100","1");
  const hints=await registrationStep(h.deps,"100","999");
  expect(replyText(hints)).toContain("Помещение не найдено");
  expect(h.state.step).toBe("number");
  expect(h.state.premise_choice_token).toBeTruthy();
  expect(replyText(hints)).toContain(`?start=premise_${pid}_${h.state.premise_choice_token}`);
  const link=`/start premise_${pid}_${h.state.premise_choice_token}`;
  const result=await registrationStep(h.deps,"100",link);
  expect(h.state.premises_id).toBe(pid);
  expect(h.state.step).toBe("role");
  expect(replyText(result)).toContain("Ваша роль");
  const stale=await registrationStep(h.deps,"100",link);
  expect(replyText(stale)).toContain("уже неактивен");
  expect(h.state.step).toBe("role");
});

it.each(["/start", "/cancel", "Старт"])("%s: регистрация скрыта только при действующем профиле", async input => {
  for (const profile of [false, true]) {
    const h = harness({ profile });
    const reply = await registrationStep(h.deps, "100", input);
    expect(typeof reply).toBe("object");
    if (typeof reply === "string") throw new Error("Ожидалось меню");
    expect(reply.buttons?.flat().some(button => button.data === "/register")).toBe(!profile);
  }
});

describe("бот: приглашение и привязка жильца (ADR-020)", () => {
  it("/invite — одно нажатие: Deep Link и срок действия, без помещения", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/invite");
    expect(replyText(reply)).toContain("https://t.me/munar_tau_user_bot?start=invite_");
    expect(replyText(reply)).not.toContain("/start");
    expect(replyText(reply)).toContain("Действует до");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Копировать", copy: true }]],
    });
    if (typeof reply === "string") throw new Error("Ожидались кнопки");
    const copied = reply.buttons?.[0]?.[0];
    expect(copied?.data).toMatch(/^https:\/\/t\.me\/munar_tau_user_bot\?start=invite_[0-9a-z]+$/);
    expect(h.audit[0]).toMatchObject({ action: "registration.invite.create" });
    expect(h.audit[0]?.entityType).toBe("invite");
  });

  it("/invite — не-собственнику доступ запрещён", async () => {
    const h = harness({ profile: true, isOwner: false });
    const reply = await registrationStep(h.deps, "100", "/invite");
    expect(replyText(reply)).toContain("собственникам помещений");
    expect(h.audit).toEqual([]);
  });

  it("/bind без приглашённых — подсказка и кнопка приглашения", async () => {
    const h = harness({ profile: true });
    const reply = await registrationStep(h.deps, "100", "/bind");
    expect(replyText(reply)).toContain("никто не зарегистрировался");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Пригласить", data: "/invite" }]],
    });
  });

  it("/bind полный проход: жилец → помещение → роль, аудит и итог", async () => {
    const h = harness({
      profile: true,
      bindPersons: [{ id: "pers-9", full_name: "Алия Омарова" }],
      bindPremises: [{ premises_id: "p1", kind: "apartment", number: "4", code: "107/1" }],
      invitedPerson: { id: "pers-9", is_test: false },
    });
    const list = await registrationStep(h.deps, "100", "/bind");
    expect(replyText(list)).toContain("Алия Омарова");
    expect(list).toMatchObject({
      buttons: [[{ text: "Алия Омарова", data: "/bind 1" }]],
    });
    const premises = await registrationStep(h.deps, "100", "/bind 1");
    expect(replyText(premises)).toContain("Алия Омарова");
    expect(premises).toMatchObject({
      buttons: [[{ text: "107/1/4", data: "/bind 1 1" }]],
    });
    const role = await registrationStep(h.deps, "100", "/bind 1 1");
    expect(role).toMatchObject({
      buttons: [
        [{ text: "Арендатор", data: "/bind 1 1 tenant" }],
        [{ text: "Проживающий", data: "/bind 1 1 resident" }],
        [{ text: "Пользователь", data: "/bind 1 1 other" }],
      ],
    });
    const done = await registrationStep(h.deps, "100", "/bind 1 1 tenant");
    expect(replyText(done)).toContain("Доступ открыт");
    expect(h.audit.some((a) => a.action === "connection.bind")).toBe(true);
    expect(h.state).toEqual({});
  });

  it("/bind — жилец уже привязан к помещению", async () => {
    const h = harness({
      profile: true,
      bindPersons: [{ id: "pers-9", full_name: "Алия Омарова" }],
      bindPremises: [{ premises_id: "p1", kind: "apartment", number: "4", code: "107/1" }],
      invitedPerson: { id: "pers-9", is_test: false },
      bindExisting: true,
    });
    await registrationStep(h.deps, "100", "/bind");
    await registrationStep(h.deps, "100", "/bind 1");
    const reply = await registrationStep(h.deps, "100", "/bind 1 1 tenant");
    expect(replyText(reply)).toContain("уже привязан");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Доступы", data: "/accesses" }]],
    });
  });

  it("/bind — не мой приглашённый: список устарел", async () => {
    const h = harness({
      profile: true,
      bindPremises: [{ premises_id: "p1", kind: "apartment", number: "4", code: "107/1" }],
    });
    const personId = "55555555-5555-5555-5555-555555555555";
    await registrationStep(h.deps, "100", `/bind ${personId}`);
    const reply = await registrationStep(
      h.deps,
      "100",
      `/bind ${personId} 1 tenant`,
    );
    expect(replyText(reply)).toContain("привязать нельзя");
  });

  it("deep-link: зарегистрированный пользователь consume без мастера, инициатор уведомлён", async () => {
    const h = harness({
      profile: true,
      inviteToken: {
        id: "invite-1",
        token: "TOK",
        status: "active",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_by: "creator-1",
        premises_id: null,
      },
      inviteCreator: { is_test: false },
    });
    const reply = await registrationStep(h.deps, "100", "/start invite_TOK");
    expect(replyText(reply)).toContain("уже зарегистрированы");
    expect(h.audit.some((a) => a.action === "registration.invite.accept")).toBe(true);
    expect(h.state).toEqual({});
  });

  it("deep-link: новый пользователь — мастер и анкета без помещения", async () => {
    const h = harness({
      inviteToken: {
        id: "invite-1",
        token: "TOK",
        status: "active",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_by: "creator-1",
        premises_id: null,
      },
      inviteCreator: { is_test: false },
    });
    await registrationStep(h.deps, "100", "/start invite_TOK");
    await registrationStep(h.deps, "100", "ru");
    await registrationStep(h.deps, "100", "Новый Жилец");
    const phone = await registrationStep(h.deps, "100", "+77771234567");
    expect(replyText(phone)).toContain("Подтвердите согласие");
    const done = await registrationStep(h.deps, "100", "да");
    expect(replyText(done)).toContain("зарегистрированы в ОСИ");
    expect(h.audit.some((a) => a.action === "registration.invite.accept")).toBe(true);
    expect(h.state).toEqual({});
  });

  it("deep-link: использованная ссылка — приглашение недействительно", async () => {
    const h = harness({
      profile: true,
      inviteToken: {
        id: "invite-1",
        token: "TOK",
        status: "used",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_by: "creator-1",
        premises_id: null,
      },
    });
    const reply = await registrationStep(h.deps, "100", "/start invite_TOK");
    expect(replyText(reply)).toContain("недействительно");
    expect(h.audit).toEqual([]);
  });
});

describe("бот: отправленные приглашения в /accesses (ADR-020)", () => {
  const inviteRow = {
    id: "inv-1",
    token: "tok-1",
    expires_at: "2099-10-27T10:00:00.000Z",
  };

  it("секция приглашений — отдельным блоком с кнопкой отзыва", async () => {
    const h = harness({ profile: true, inviteRows: [inviteRow] });
    const reply = await registrationStep(h.deps, "100", "/accesses");
    const text = replyText(reply);
    expect(text).toContain("Отправленные приглашения:");
    expect(reply).toMatchObject({
      buttons: [[{ text: "Отозвать — 1", data: "/revokeinvite 1" }]],
    });
    expect(h.state.invite_options).toEqual(["inv-1"]);
  });

  it("обе секции на одном экране", async () => {
    const h = harness({
      profile: true,
      accessRows: [{
        id: "conn-1",
        confirmed_by: "pers-1",
        full_name: "Алия Омарова",
        kind: "apartment",
        number: "4",
        registration_id: REG_ID,
      }],
      inviteRows: [inviteRow],
    });
    const reply = await registrationStep(h.deps, "100", "/accesses");
    const text = replyText(reply);
    expect(text).toContain("Выданные доступы:");
    expect(text).toContain("Отправленные приглашения:");
    expect(typeof reply !== "string" && reply.buttons?.flat().map((b) => b.data)).toEqual([
      "/revoke 1",
      "/dispute 1",
      "/revokeinvite 1",
    ]);
  });

  it("отзыв приглашения — без причины, приглашение гасится", async () => {
    const h = harness({
      profile: true,
      inviteRows: [inviteRow],
      // revokeInvite: строка приглашения по id (select * from invite … for update).
      inviteToken: {
        id: "inv-1",
        token: "tok-1",
        status: "active",
        expires_at: "2099-10-27T10:00:00.000Z",
        created_by: "pers-1",
        premises_id: null,
      },
    });
    await registrationStep(h.deps, "100", "/accesses");
    const reply = await registrationStep(h.deps, "100", "/revokeinvite 1");
    expect(replyText(reply)).toContain("Приглашение отозвано");
    expect(h.audit[0]).toMatchObject({
      action: "registration.invite.revoke",
    });
    expect(h.state).toEqual({});
  });
});
