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

function harness(opts: { profile?: boolean; failUsernameSync?: boolean; failedUpdate?: number } = {}) {
  const delivered = new Set<string>(opts.failedUpdate===undefined?[]:[`resident:${opts.failedUpdate}`]);
  let retried=false;
  const notifications: Capture[] = [];
  const dialogSaves: Capture[] = [];
  const usernameSyncs: Capture[] = [];
  const dialogState: Row = {};
  const exec: DbExecutor = {
    query: <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.startsWith("insert into bot_inbound")) {
        const key = `${params![0]}:${params![1]}`;
        if (delivered.has(key)) {
          if(!retried&&opts.failedUpdate===params![1]&&sql.includes("where bot_inbound.status='error'")){retried=true;return Promise.resolve([{update_id:params![1]}] as T[]);}
          return Promise.resolve([] as T[]);
        }
        delivered.add(key);
        return Promise.resolve([{ update_id: params![1] }] as T[]);
      }
      if (sql.startsWith("select state from bot_dialog")) {
        return Promise.resolve([{ state: dialogState }] as T[]);
      }
      if (sql.startsWith("select id,code,construction_phase from building")) return Promise.resolve([{id:"00000000-0000-4000-8000-000000000001",code:"102/1",construction_phase:1}] as T[]);
      if (sql.startsWith("insert into notification")) {
        notifications.push({ sql, params });
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("update bot_dialog_channel set state")) {
        dialogSaves.push({ sql, params });
        return Promise.resolve([] as T[]);
      }
      if (sql.startsWith("update profile set telegram_username") ||
        sql.startsWith("update registration set telegram_username")) {
        if (opts.failUsernameSync) return Promise.reject(new Error("sync down"));
        usernameSyncs.push({ sql, params });
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
    usernameSyncs,
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
    // Справка предлагает только отмену.
    const parsed = JSON.parse(markup!) as { inline_keyboard: { text: string;callback_data:string }[][] };
    expect(parsed.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(["/cancel"]);
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
    // У ошибки остаётся только отмена, без несвязанного меню.
    expect(JSON.parse(String(h.notifications[0]!.params![4])).inline_keyboard.flat().map((b:{callback_data:string})=>b.callback_data)).toEqual(["/cancel"]);
  });

  it("ответ без контекстных действий получает только отмену", async () => {
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
    expect(JSON.parse(String(h.notifications[0]!.params![4])).inline_keyboard.flat().map((b:{callback_data:string})=>b.callback_data)).toEqual(["/cancel"]);
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

describe("processInbound: имя в Telegram (display-only метаданные)", () => {
  it("username из обновления уходит в профиль и снимок активных анкет", async () => {
    const h = harness();
    const update = textUpdate(40, "/help");
    ((update.message as Row).from as Row).username = "w84gr8";
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.usernameSyncs.length).toBe(2);
    expect(h.usernameSyncs[0]!.sql.startsWith("update profile set telegram_username")).toBe(true);
    expect(h.usernameSyncs[0]!.params).toEqual(["100", "w84gr8"]);
    expect(h.usernameSyncs[1]!.sql.startsWith("update registration set telegram_username")).toBe(true);
    expect(h.usernameSyncs[1]!.params).toEqual(["100", "w84gr8"]);
  });

  it("username из callback_query тоже синхронизируется", async () => {
    const h = harness();
    const update = helpCallback(41);
    ((update.callback_query as Row).from as Row).username = "oleg_san_krasnov";
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.usernameSyncs[0]!.params).toEqual(["100", "oleg_san_krasnov"]);
  });

  it("сообщение без username очищает сохранённое имя (null)", async () => {
    const h = harness();
    expect(await processInbound(h.deps, textUpdate(42, "/help"), "resident")).toBe(true);
    expect(h.usernameSyncs.map((s) => s.params)).toEqual([["100", null], ["100", null]]);
  });

  it("некорректный username не попадает в базу", async () => {
    const h = harness();
    const update = textUpdate(42, "/help");
    ((update.message as Row).from as Row).username = "не username!";
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    expect(h.usernameSyncs.map((s) => s.params)).toEqual([["100", null], ["100", null]]);
  });

  it("сбой синхронизации имени не ломает обработку обновления", async () => {
    const h = harness({ failUsernameSync: true });
    const update = textUpdate(43, "/help");
    ((update.message as Row).from as Row).username = "w84gr8";
    expect(await processInbound(h.deps, update, "resident")).toBe(true);
    // Ответ пользователю ушёл, несмотря на отказ синхронизации.
    expect(h.notifications.length).toBe(1);
    expect(h.usernameSyncs.length).toBe(0);
  });
});

describe("processInbound: команды не глотаются активным сценарием", () => {
  it("кнопка Помощь открывает сгруппированную справку из активного диалога", async () => {
    const h = harness();
    stuckInPlace(h);
    expect(await processInbound(h.deps, textUpdate(80, "❓ Помощь"), "resident")).toBe(true);
    expect(replyOf(h)).toContain("<b>Регистрация</b>");
    expect(replyOf(h)).toContain("📝 /register — Зарегистрироваться.");
    expect(replyOf(h)).toContain("<b>Обращения</b>");
  });

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


it("Telegram house-link выбирает дом в текущем шаге, без главного меню", async () => {
 const h=harness({profile:true});
 Object.assign(h.dialogState,{scenario:"registration",step:"building",house_choice_token:"123456abcdef"});
 await processInbound(h.deps,{update_id:601,message:{text:"/start house_00000000-0000-4000-8000-000000000001_123456abcdef",from:{id:100},chat:{id:100,type:"private"}}},"resident");
 expect(h.notifications[0]?.params?.[1]).toContain("Тип помещения");
 const keyboard=JSON.parse(String(h.notifications[0]?.params?.[4])).inline_keyboard.flat();
 expect(keyboard.some((button:{callback_data:string})=>button.callback_data==="/register")).toBe(false);
 expect(h.dialogSaves.some(save=>String(save.params?.[1]).includes('"building_id":"00000000-0000-4000-8000-000000000001"'))).toBe(true);
});
it("устаревшая house-link не сбрасывает другой диалог",async()=>{
 const h=harness({profile:true});
 Object.assign(h.dialogState,{scenario:"requests",step:"description",description:"Мой черновик"});
 await processInbound(h.deps,{update_id:602,message:{text:"/start house_00000000-0000-4000-8000-000000000001_123456abcdef",from:{id:100},chat:{id:100,type:"private"}}},"resident");
 expect(h.notifications[0]?.params?.[1]).toContain("уже неактивен");
 expect(h.dialogSaves).toHaveLength(0);
 expect(h.dialogState.description).toBe("Мой черновик");
});

it("диагностическая error-запись повторяется один раз, processed остаётся дубликатом",async()=>{
 const h=harness({failedUpdate:700});expect(await processInbound(h.deps,helpUpdate(700))).toBe(true);expect(h.notifications).toHaveLength(1);expect(await processInbound(h.deps,helpUpdate(700))).toBe(false);expect(h.notifications).toHaveLength(1);
});

it.each(["/start", "/cancel"])("%s: транспорт сохраняет меню с учётом регистрации", async input => {
  for (const profile of [false, true]) {
    const h = harness({ profile });
    expect(await processInbound(h.deps, textUpdate(90, input), "resident")).toBe(true);
    const markup = JSON.parse(String(h.notifications[0]!.params![4])) as {
      inline_keyboard: { callback_data: string }[][];
    };
    const commands = markup.inline_keyboard.flat().map(button => button.callback_data);
    expect(commands.includes("/register")).toBe(!profile);
    expect(commands).toContain("/requests");
    expect(commands).not.toContain("/plans");
  }
});
