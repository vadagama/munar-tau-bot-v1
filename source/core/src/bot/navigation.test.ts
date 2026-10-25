import { expect, it } from "vitest";
import { navigationReply } from "./navigation.ts";
import { welcomeText } from "./help.ts";

it.each(["/start", "Старт"])("главное меню жителя открывается по %s", input => {
  const reply = navigationReply(welcomeText(), "registration", "ru", undefined, input);
  expect(typeof reply).not.toBe("string");
  if (typeof reply === "string") return;
  expect(reply.text).toBe(welcomeText());
  expect(reply.buttons?.map(row => row.map(button => button.data))).toEqual([
    ["/register"], ["/requests", "/newrequest"], ["/objects", "/add"],
    ["/invite", "/bind", "/accesses"], ["/notifications"], ["/help"],
  ]);
});
it("действующему профилю регистрация в меню не показывается (REG-01/02)", () => {
  const reply = navigationReply(welcomeText(), "registration", "ru", undefined, "/start", true);
  if (typeof reply === "string") throw new Error("Ожидалась навигация");
  const data = reply.buttons?.flat().map(button => button.data);
  expect(data).not.toContain("/register");
  expect(data).not.toContain("/status");
  expect(data?.at(-1)).toBe("/help");
});
it("справка закрывается кнопкой «В главное меню»", () => {
  const reply = navigationReply("Справка", "registration", "ru", undefined, "/help");
  if (typeof reply === "string") throw new Error("Ожидалась навигация");
  expect(reply.buttons).toEqual([[{ text: "В главное меню", data: "/cancel" }]]);
});

it.each(["registration", "requests", "incidents", "notifications"])("%s: свободный ввод закрывается кнопкой «В главное меню»", scenario => {
  for (const input of ["/add", "107/99", "Иван Иванов", "/newrequest"]) {
    const reply = navigationReply({ text: "Введите данные" }, scenario, "ru", undefined, input);
    expect(typeof reply !== "string" && reply.buttons).toEqual([[{ text: "В главное меню", data: "/cancel" }]]);
  }
});
it.each(["/add", "107/99", "Иван Иванов", "/newrequest"])("tasks: свободный ввод получает только отмену (%s)", input => {
  const reply = navigationReply({ text: "Введите данные" }, "tasks", "ru", undefined, input);
  expect(typeof reply !== "string" && reply.buttons).toEqual([[{ text: "Отменить", data: "/cancel" }]]);
});
it.each(["ru", "kk"] as const)("%s: форма отмены с той же подписью не дублируется навигацией", (lang) => {
  const cancelLabel = lang === "ru" ? "Отменить" : "Болдырмау";
  // Кнопка отмены формы ведёт к карточке (/request <number>), а не в /cancel:
  // та же подпись — вторая «Отменить» рядом была бы неразличима.
  const reply = navigationReply(
    {
      text: "Сообщение по обращению З-26-1.",
      buttons: [[{ text: cancelLabel, data: "/request З-26-1" }]],
    },
    "requests",
    lang,
    undefined,
    "свет мигает",
  );
  expect(
    typeof reply !== "string" &&
      reply.buttons?.flat().filter((b) => b.text === cancelLabel).length,
  ).toBe(1);
});
it("контекстные кнопки сохраняются, отмена не дублируется", () => {
  const reply = navigationReply({ text: "Тип помещения", buttons: [[{text:"Квартира",data:"1"}],[{text:"Отменить",data:"/cancel"}]] }, "registration", "ru", undefined, "107/1");
  expect(typeof reply !== "string" && reply.buttons?.flat().map(button => button.data)).toEqual(["1", "/cancel"]);
});

it("меню сотрудника открывает финансовые обязанности кнопкой", () => {
  const reply = navigationReply("Справка", "tasks", "kk", undefined, "/start");
  expect(typeof reply !== "string" && reply.buttons?.flat().some(b => b.data === "/financialduties")).toBe(true);
});

it("личная работа доступна только сотруднику",()=>{
 const worker=navigationReply("Меню","tasks","ru",undefined,"/start"),resident=navigationReply("Меню","registration","kk",undefined,"/start");
 expect(typeof worker!=="string"&&worker.buttons?.flat().some(b=>b.data==="/mywork")).toBe(true);expect(typeof resident!=="string"&&resident.buttons?.flat().some(b=>b.data==="/mywork")).toBe(false);
});

it.each(["ru", "kk"] as const)("оба меню скрывают отложенные функции (%s)", lang => {
  for (const scenario of ["registration", "tasks"]) {
    for (const input of ["/start", "/cancel"]) {
      const reply = navigationReply("Меню", scenario, lang, undefined, input);
      if (typeof reply === "string") throw new Error("Ожидалось меню");
      const commands = reply.buttons?.flat().map(button => button.data);
      for (const command of ["/incidents", "/publications", "/documents", "/financial", "/polls", "/initiatives", "/emergency", "/emergencyrequest", "/pending", "/plans"]) {
        expect(commands).not.toContain(command);
      }
    }
  }
});
