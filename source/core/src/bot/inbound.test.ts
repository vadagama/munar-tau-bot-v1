/**
 * Модульные тесты входа бота (срез UX B): callback_query исполняется как
 * текстовый эквивалент команды, reply-меню прикрепляется к /start и /help,
 * повторная доставка того же update не отвечает второй раз (дедуп по
 * паре (bot, update_id)). SQL имитируется по префиксам запросов — как в
 * registration.test.ts.
 */
import { describe, expect, it } from "vitest";

import { processInbound } from "./inbound.ts";
import type { DbClient, DbExecutor } from "../db/client.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";

interface Capture {
  params?: unknown[];
  sql: string;
}

function harness(opts: { profile?: boolean } = {}) {
  const delivered = new Set<string>();
  const notifications: Capture[] = [];
  const dialogSaves: Capture[] = [];
  const dialogState: Row = {};
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.startsWith("insert into bot_inbound")) {
        const key = `${params![0]}:${params![1]}`;
        if (delivered.has(key)) return Promise.resolve([] as T[]);
        delivered.add(key);
        return Promise.resolve([{ update_id: params![1] }] as T[]);
      }
      if (sql.startsWith("select state from bot_dialog")) {
        return Promise.resolve([{ state: dialogState }] as T[]);
      }
      if (sql.startsWith("insert into notification")) {
        notifications.push({ sql, params });
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("update bot_dialog_channel set state")) {
        dialogSaves.push({ sql, params });
        return Promise.resolve([] as T[]);
      }
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
            language: "ru",
            is_test: true,
            archived_at: null,
          }] as T[]);
        }
        if (sql.startsWith("select id, full_name, phone_e164")) {
          return Promise.resolve([{
            id: "pers-1",
            full_name: "Тест Тестов",
            phone_e164: null,
            status: "active",
            is_test: true,
            comment: null,
          }] as T[]);
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
    deps: { db, audit: {} } as unknown as RegistryDeps,
    notifications,
    dialogState,
    dialogSaves,
  };
}

const helpUpdate = (updateId: number): Row => ({
  update_id: updateId,
  message: {
    text: "/help",
    from: { id: 100 },
    chat: { id: 100, type: "private" },
  },
});

const helpCallback = (updateId: number): Row => ({
  update_id: updateId,
  callback_query: {
    id: `cb${updateId}`,
    data: "/help",
    from: { id: 100 },
    message: { chat: { id: 100, type: "private" } },
  },
});

describe("processInbound: callback_query (срез UX B)", () => {
  it("нажатие кнопки исполняется как её текстовая команда и получает reply-меню", async () => {
    const h = harness();
    const processed = await processInbound(h.deps, helpCallback(1), "resident");
    expect(processed).toBe(true);
    expect(h.notifications.length).toBe(1);
    const [, text, , bot, markup] = h.notifications[0]!.params as [
      unknown,
      string,
      unknown,
      string,
      string | null,
    ];
    // Справка бота жителей уходит тем же ботом.
    expect(text).toContain("ОСИ ЖК «Мунар Тау»");
    expect(bot).toBe("resident");
    // Меню главных действий прикрепляется к /help — как и для текста команды;
    // подписи кнопок — с иконками (map в help.ts резолвит их в команды).
    const parsed = JSON.parse(markup!) as { inline_keyboard: { text: string;callback_data:string }[][] };
    expect(parsed.inline_keyboard.flat().map((b) => b.callback_data)).toContain("/newrequest");
  });

  it("кнопка reply-меню исполняется как её команда («Мои помещения» → /objects)", async () => {
    const h = harness();
    const update: Row = {
      update_id: 5,
      message: {
        text: "🏠 Мои помещения",
        from: { id: 100 },
        chat: { id: 100, type: "private" },
      },
    };
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.notifications.length).toBe(1);
    // Без профиля /objects отвечает подсказкой регистрации — команда дошла.
    expect(h.notifications[0]!.params![1]).toContain("Сначала регистрация.");
  });

  it("кнопка сценария без профиля — дружелюбная ошибка вместо кода API", async () => {
    const h = harness();
    const update: Row = {
      update_id: 2,
      callback_query: {
        id: "cb2",
        data: "/requests",
        from: { id: 100 },
        message: { chat: { id: 100, type: "private" } },
      },
    };
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.notifications.length).toBe(1);
    expect(h.notifications[0]!.params![1]).toContain("Недостаточно прав");
    // Меню на команду /requests не прикрепляется — разметки нет.
    expect(JSON.parse(String(h.notifications[0]!.params![4])).inline_keyboard.flat().some((b:{callback_data:string})=>b.callback_data==="/register")).toBe(true);
  });

  it("обычное сообщение без команды-меню уходит без разметки", async () => {
    const h = harness();
    const update: Row = {
      update_id: 3,
      message: {
        text: "/status",
        from: { id: 100 },
        chat: { id: 100, type: "private" },
      },
    };
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.notifications.length).toBe(1);
    expect(h.notifications[0]!.params![1]).toContain("Анкет пока нет");
    expect(JSON.parse(String(h.notifications[0]!.params![4])).inline_keyboard.flat().some((b:{callback_data:string})=>b.callback_data==="/register")).toBe(true);
  });

  it("повторная доставка update не отвечает второй раз (дедуп по паре bot+update_id)", async () => {
    const h = harness();
    expect(await processInbound(h.deps, helpUpdate(4), "resident")).toBe(true);
    expect(await processInbound(h.deps, helpUpdate(4), "resident")).toBe(false);
    expect(h.notifications.length).toBe(1);
  });

  it("некорректный update_id отклоняется до записи в bot_inbound", async () => {
    const h = harness();
    await expect(
      processInbound(h.deps, { update_id: "мусор" }, "resident"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(h.notifications.length).toBe(0);
  });
});

/** Активный сценарий обращений на шаге выбора помещения (инцидент 17.10.2026). */
function stuckInPlace(h: ReturnType<typeof harness>): void {
  h.dialogState.scenario = "requests";
  h.dialogState.step = "place";
  h.dialogState.place_options = [{ id: "prem-1", building_id: "bld-1" }];
}

const textUpdate = (updateId: number, text: string): Row => ({
  update_id: updateId,
  message: {
    text,
    from: { id: 100 },
    chat: { id: 100, type: "private" },
  },
});

const replyOf = (h: ReturnType<typeof harness>): string =>
  h.notifications[0]!.params![1] as string;

describe("processInbound: команды не глотаются активным сценарием", () => {
  it("/help из шага выбора помещения — справка жителя, а не «Выберите номер»", async () => {
    const h = harness();
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(10, "/help"), "resident")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("ОСИ ЖК «Мунар Тау»");
    expect(text).not.toContain("Выберите номер");
    // Справка прикрепляет reply-меню, как и вне сценария.
    expect(h.notifications[0]!.params![4]).not.toBeNull();
  });

  it("/status из шага выбора помещения — список анкет", async () => {
    const h = harness();
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(11, "/status"), "resident")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("Анкет пока нет");
    expect(text).not.toContain("Выберите номер");
  });

  it("/cancel из чужого сценария очищает диалог и показывает справку", async () => {
    const h = harness();
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(12, "/cancel"), "resident")).toBe(true);
    expect(replyOf(h)).toContain("ОСИ ЖК «Мунар Тау»");
    // Анкета сохраняет копию состояния — проверяем сохранённое, а не ссылку.
    const saved = JSON.parse(h.dialogSaves.at(-1)!.params![1] as string) as Row;
    expect(saved).toEqual({});
  });

  it("неизвестная команда из шага выбора помещения не застревает в сценарии", async () => {
    const h = harness();
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(13, "/что-то"), "resident")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("ОСИ ЖК «Мунар Тау»");
    expect(text).not.toContain("Выберите номер");
  });

  it("/notifications уходит в настройки уведомлений, а не в справку", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(14, "/notifications"), "resident")).toBe(true);
    expect(replyOf(h)).toContain("Сначала подтвердите регистрацию");
  });

  it("свободный текст при сценарии обращений уходит в обращения: выбор помещения продолжает диалог", async () => {
    const h = harness({ profile: true });
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(15, "1"), "resident")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("Опишите проблему");
    expect(text).not.toContain("Выберите номер");
    expect(h.dialogState.step).toBe("description");
    expect(h.dialogState.premises_id).toBe("prem-1");
  });

  it("свободный текст вне сценария остаётся в анкете регистрации", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(16, "привет"), "resident")).toBe(true);
    const text = replyOf(h);
    // Без профиля свободный текст ведёт в анкету (справка), а не в обращения
    // (те без профиля ответили бы «Недостаточно прав»).
    expect(text).toContain("ОСИ ЖК «Мунар Тау»");
    expect(text).not.toContain("Недостаточно прав");
  });

  it("/help доступен сотруднику из сценария заданий", async () => {
    const h = harness();
    h.dialogState.scenario = "tasks";
    h.dialogState.step = "report";
    expect(await processInbound(h.deps, textUpdate(17, "/help"), "worker")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("бот сотрудников");
    expect(h.notifications[0]!.params![3]).toBe("worker");
  });
});

describe("processInbound: маршрутизация инцидентов и публикаций (EMG/PUB)", () => {
  it("/publications уходит в сценарий инцидентов, а не в справку", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(30, "/publications"), "resident")).toBe(true);
    const text = replyOf(h);
    // Без профиля инцидентный сценарий отвечает ошибкой прав, а не справкой:
    // команда дошла до incidentStep (раньше её глотала registrationStep).
    expect(text).toContain("Подтвердите регистрацию");
    expect(text).not.toContain("ОСИ ЖК «Мунар Тау»");
  });

  it("/emergency без аргументов отвечает подсказкой даже без профиля", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(31, "/emergency"), "resident")).toBe(true);
    expect(replyOf(h)).toContain("Укажите код дома");
  });

  it("/signals доступен в боте сотрудников (дежурство)", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(32, "/signals"), "worker")).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("Подтвердите регистрацию");
    expect(text).not.toContain("бот сотрудников");
  });
});

describe("processInbound: глубокие ссылки /start (срез C)", () => {
  const uuid = "01890a5d-ac96-774b-bcce-b302e9aa8453";

  it("/start req_<uuid> у жителя открывает карточку обращения, а не справку", async () => {
    const h = harness({ profile: true });
    expect(
      await processInbound(h.deps, textUpdate(20, `/start req_${uuid}`), "resident"),
    ).toBe(true);
    const text = replyOf(h);
    // Профиль есть, но обращение с таким id нет (моки пустые) — маршрутизация
    // дошла до requestStep и вернула дружелюбную ошибку NOT_FOUND.
    expect(text).toContain("Не найдено");
    expect(text).not.toContain("ОСИ ЖК «Мунар Тау»");
  });

  it("/start wrk_<uuid> у сотрудника открывает карточку задания", async () => {
    const h = harness({ profile: true });
    expect(
      await processInbound(h.deps, textUpdate(21, `/start wrk_${uuid}`), "worker"),
    ).toBe(true);
    const text = replyOf(h);
    expect(text).toContain("Не найдено");
    expect(text).not.toContain("бот сотрудников");
  });

  it("payload другого бота не уводит из справки: req_ у сотрудника — workerHelp", async () => {
    const h = harness({ profile: true });
    expect(
      await processInbound(h.deps, textUpdate(22, `/start req_${uuid}`), "worker"),
    ).toBe(true);
    expect(replyOf(h)).toContain("бот сотрудников");
  });

  it("/start без payload сохраняет прежнее поведение (меню/справка)", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(23, "/start"), "resident")).toBe(true);
    expect(replyOf(h)).toContain("ОСИ ЖК «Мунар Тау»");
  });
});
