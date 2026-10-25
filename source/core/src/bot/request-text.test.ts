import { expect, it } from "vitest";
import { preview, requestCardText, requestListText } from "./request-text.ts";
import { replyText } from "./keyboard.ts";

it("номер обращения с UUID — глубокая ссылка на бота жителя с username из среды", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const rows = [{
    id,
    number: "З-26-1",
    state: "in_work",
    author_person_id: "author",
    description: "Не работает свет",
    created_at: "2026-10-20T07:00:00Z",
  }];
  // Фолбэк — фактический username бота жителя; ссылка на несуществующего
  // бота даёт в Telegram «Username not found» (регрессия 22.10.2026).
  const reply = requestListText(rows, "author", 1);
  expect(replyText(reply)).toContain(
    `href="https://t.me/munar_tau_user_bot?start=req_${id}"`,
  );
  // Username из среды подставляется вместо фолбэка.
  const custom = requestListText(
    rows,
    "author",
    1,
    "ru",
    undefined,
    "munar_tau_resident_bot",
  );
  expect(replyText(custom)).toContain(
    `href="https://t.me/munar_tau_resident_bot?start=req_${id}"`,
  );
  // Строка без UUID-id (симулятор, черновик) остаётся текстом без ссылки.
  const plain = requestListText(
    [{
      number: "З-26-2",
      state: "in_work",
      author_person_id: "author",
      description: "d",
    }],
    "author",
    1,
  );
  expect(replyText(plain)).not.toContain("t.me/");
  // Невалидный username из среды не попадает в URL.
  expect(() =>
    requestListText(rows, "author", 1, "ru", undefined, "bad username")
  ).toThrow();
});

it("длинная история и список помещаются в sendMessage и предлагают следующую страницу", () => {
  const rows = Array.from(
    { length: 20 },
    (_, i) => ({
      number: `З-26-${i}`,
      state: "awaiting_confirmation",
      author_person_id: "author",
      description: "Длинный текст ".repeat(1000),
    }),
  );
  const reply = requestListText(rows, "author", 1);
  const text = replyText(reply);
  expect(text.length).toBeLessThanOrEqual(4000);
  expect(text).not.toContain("З-26-19");
  // Пагинация — кнопкой «Далее»; текстовая подсказка больше не дублируется.
  expect(
    typeof reply === "object" &&
      reply.buttons?.at(-1)?.[0]?.data === "/requests page:2",
  ).toBe(true);
  expect(text).not.toContain("/requests page:2");
  // Каждая строка списка открывается кнопкой с точной командой.
  expect(
    typeof reply === "object" && reply.buttons?.[0]?.[0]?.data,
  ).toBe("/request З-26-0");
  const cardReply = requestCardText({
    ...rows[0]!,
    confirmation_version: 2,
    messages: Array.from(
      { length: 20 },
      () => ({ channel: "resident", text: "Сообщение ".repeat(1000) }),
    ),
  });
  expect(replyText(cardReply).length).toBeLessThanOrEqual(4000);
  // Технические версии результата в карточке больше не показываются.
  expect(replyText(cardReply)).not.toContain("Версия результата");
});

it("превью не обрывает emoji на половине UTF-16 пары", () => {
  expect(preview("🙂🙂🙂", 4)).toBe("🙂…");
});

it("карточка показывает действия по состоянию и экранирует пользовательский текст", () => {
  const card = requestCardText({
    number: "З-26-1",
    state: "awaiting_confirmation",
    author_person_id: "author",
    description: "Описание с <b>разметкой</b> & кавычками",
    confirmation_version: 1,
    messages: [],
  });
  const text = replyText(card);
  expect(text).toContain("<b>З-26-1</b>");
  expect(text).toContain("&lt;b&gt;разметкой&lt;/b&gt;");
  expect(text).not.toContain("<b>разметкой");
  // Версия подтверждения несёт только кнопка; в тексте — отчёты и доработка.
  expect(text).not.toContain("/result");
  expect(text).not.toContain("Действия");
  expect(text).not.toContain("/confirm");
  // Кнопка подтверждения — точная команда с версией результата.
  expect(
    typeof card === "object" && card.buttons?.[0]?.[0]?.data,
  ).toBe("/confirm З-26-1 1");
});

it("карточка подписывает сообщения датой и автором", () => {
  const card = requestCardText({
    number: "З-26-2",
    state: "in_work",
    author_person_id: "author",
    description: "Текст",
    created_at: "2026-10-15T13:40:00Z",
    place_label: "ЖК Мунар, квартира 12, 45",
    messages: [
      {
        channel: "resident",
        text: "Уточните подъезд",
        created_at: "2026-10-17T04:05:00Z",
        author_person_id: "staff-1",
        author_kind: "staff",
      },
      {
        channel: "resident",
        text: "Второй подъезд",
        created_at: "2026-10-17T05:10:00Z",
        author_person_id: "author",
        author_kind: "author",
      },
    ],
  });
  const text = replyText(card);
  expect(text).toContain("ЖК Мунар");
  expect(text).toContain("создано 15.10.2026 18:40");
  expect(text).toContain("Администратор");
  expect(text).toContain("Вы");
});

it("закрытая карточка предлагает оценку кнопками 1–5 с командой /rate", () => {
  const card = requestCardText({
    number: "З-26-7",
    state: "closed",
    author_person_id: "author",
    description: "Готово",
    confirmation_version: 3,
    messages: [],
  });
  const data = typeof card === "object"
    ? (card.buttons?.[0] ?? []).map((b) => b.data)
    : [];
  expect(data).toEqual([
    "/rate З-26-7 1",
    "/rate З-26-7 2",
    "/rate З-26-7 3",
    "/rate З-26-7 4",
    "/rate З-26-7 5",
  ]);
});

it("черновик открывается кнопкой возобновления отправки", () => {
  const reply = requestListText(
    [{
      number: null,
      state: "draft",
      author_person_id: "author",
      description: "d",
    }],
    "author",
    1,
  );
  const text = replyText(reply);
  expect(text).toContain("Черновик");
  expect(text).not.toContain(" / ");
  // Черновик не имеет номера: кнопка возобновляет мастер отправки.
  expect(
    typeof reply === "object" && reply.buttons?.[0]?.[0]?.data,
  ).toBe("/newrequest");
});

it("менее 10 обращений — список без пагинации", () => {
  const reply = requestListText(
    [{
      number: "З-26-1",
      state: "in_work",
      author_person_id: "author",
      description: "d",
    }],
    "author",
    1,
  );
  expect(
    typeof reply === "object" &&
      reply.buttons?.flat().map((b) => b.data),
  ).toEqual(["/request З-26-1"]);
});

it("пустой список предлагает новое обращение", () => {
  const reply = requestListText([], "author", 1);
  expect(replyText(reply)).toContain("Обращений нет");
  expect(
    typeof reply === "object" &&
      reply.buttons?.flat().map((b) => [b.text, b.data]),
  ).toEqual([["Новое обращение", "/newrequest"]]);
});

it("кнопка архива появляется только когда есть закрытые обращения", () => {
  const rows = [{
    number: "З-26-1",
    state: "in_work",
    author_person_id: "author",
    description: "d",
  }];
  const plain = requestListText(rows, "author", 1);
  expect(replyText(plain)).not.toContain("Архив");
  const withArchive = requestListText(
    rows,
    "author",
    1,
    "ru",
    undefined,
    undefined,
    { hasArchive: true },
  );
  expect(
    typeof withArchive === "object" && withArchive.buttons?.at(-1)?.[0],
  ).toEqual({ text: "Архив", data: "/requests archive" });
});

it("архив: пагинация внутри архива и выход к активным без кнопки архива", () => {
  const rows = Array.from(
    { length: 11 },
    (_, i) => ({
      number: `З-26-${i}`,
      state: "closed",
      author_person_id: "author",
      description: "d",
    }),
  );
  const first = requestListText(
    rows,
    "author",
    1,
    "ru",
    undefined,
    undefined,
    { archive: true },
  );
  const data = typeof first === "object"
    ? first.buttons?.flat().map((b) => b.data)
    : [];
  expect(data).toContain("/requests archive page:2");
  expect(data).not.toContain("/requests page:2");
  expect(data).toContain("/requests");
  expect(data).not.toEqual(expect.arrayContaining(["/requests archive"]));
  expect(data).not.toContain("/newrequest");
  const second = requestListText(
    rows,
    "author",
    2,
    "ru",
    undefined,
    undefined,
    { archive: true },
  );
  expect(
    typeof second === "object" &&
      second.buttons?.flat().find((b) => b.data === "/requests archive page:1"),
  ).toBeTruthy();
});

it("целая карточка и подпись кнопки меняются одним шаблоном, данные экранируются", () => {
  const store = new Map([["message.requests.card.confirmation", {
    ru:
      "<b>Результат {number}</b>\n{description}\nПроверьте выполненные работы.",
    kk: "<b>Нәтиже {number}</b>\n{description}",
    buttons: {
      ru: { confirm: "Работы выполнены" },
      kk: { confirm: "Орындалды" },
    },
  }]]);
  const result = requestCardText(
    {
      number: "З-26-1",
      state: "awaiting_confirmation",
      description: "<script>&",
      messages: [],
      confirmation_version: 7,
    },
    "ru",
    store,
  );
  expect(replyText(result)).toBe(
    "<b>Результат З-26-1</b>\n&lt;script&gt;&amp;\nПроверьте выполненные работы.",
  );
  expect(typeof result === "object" && result.buttons?.[0]?.[0]).toEqual({
    text: "Работы выполнены",
    data: "/confirm З-26-1 7",
  });
});

it("шаблон списка окружает серверные строки и сохраняет команды кнопок", () => {
  const store = new Map([["message.requests.list", {
    ru: "Ваши обращения:\n{requests}\nВыберите нужное.",
    kk: "{requests}",
  }]]);
  const result = requestListText(
    [{
      number: "З-26-1",
      state: "in_work",
      description: "<img>",
      author_person_id: "author",
    }],
    "author",
    1,
    "ru",
    store,
  );
  expect(replyText(result)).toContain("Ваши обращения:\n");
  expect(replyText(result)).toContain("&lt;img&gt;");
  expect(replyText(result)).not.toContain("&amp;lt;");
  expect(replyText(result)).toMatch(/Выберите нужное\.$/);
  expect(typeof result === "object" && result.buttons?.[0]?.[0]?.data).toBe(
    "/request З-26-1",
  );
});

it("заголовки истории и отчётов принадлежат полному шаблону карточки", () => {
  const store = new Map([["message.requests.card.active", {
    ru:
      "Переписка жителей:\n{messages}\nВыполненные работы ({report_count}): {report_command}",
    kk: "{messages}",
  }]]);
  const card = requestCardText(
    {
      number: "З-26-1",
      state: "in_work",
      description: "d",
      messages: [],
      confirmation: { payload: { task_results: [{}] } },
    },
    "ru",
    store,
  );
  expect(replyText(card)).toBe(
    "Переписка жителей:\n—\nВыполненные работы (1): /result З-26-1",
  );
  expect(replyText(card)).not.toContain("Сообщения:");
  expect(replyText(card)).not.toContain("Отчёты:");
});
