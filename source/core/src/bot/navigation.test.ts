import { expect, it } from "vitest";
import { navigationReply } from "./navigation.ts";
import { menuCommand, welcomeText } from "./help.ts";

it.each(["/start", "Старт"])("главное меню жителя открывается по %s", input => {
  const reply = navigationReply(welcomeText(), "registration", "ru", undefined, input);
  expect(typeof reply).not.toBe("string");
  if (typeof reply === "string") return;
  expect(reply.text).toBe("<b>ОСИ ЖК «Мунар Тау»</b>\nРегистрация, помещения, обращения и уведомления.\nПри непосредственной угрозе жизни звоните 112.");
  expect(reply.buttons?.map(row => row.map(button => button.data))).toEqual([
    ["/status", "/register", "/help"], ["/objects", "/add"],
    ["/requests", "/newrequest"], ["/invite", "/accesses"],
    ["/incidents", "/publications"], ["/documents", "/financial"], ["/emergency", "/notifications"],
    ["/pending"], ["/cancel"],
  ]);
});
it("справка предлагает вернуться на старт", () => {
  const reply = navigationReply("Справка", "registration", "ru", undefined, "/help");
  if (typeof reply === "string") throw new Error("Ожидалась навигация");
  expect(reply.buttons).toEqual([[{ text: "Старт", data: "/start" }], [{ text: "Отменить", data: "/cancel" }]]);
  expect(menuCommand("Старт")).toBe("/start");
});

it.each(["registration", "requests", "tasks", "incidents", "notifications"])("%s: свободный ввод получает только отмену", scenario => {
  for (const input of ["/add", "107/99", "Иван Иванов", "/newrequest"]) {
    const reply = navigationReply({ text: "Введите данные" }, scenario, "ru", undefined, input);
    expect(typeof reply !== "string" && reply.buttons).toEqual([[{ text: "Отменить", data: "/cancel" }]]);
  }
});
it("контекстные кнопки сохраняются, отмена не дублируется", () => {
  const reply = navigationReply({ text: "Тип помещения", buttons: [[{text:"Квартира",data:"1"}],[{text:"Отменить",data:"/cancel"}]] }, "registration", "ru", undefined, "107/1");
  expect(typeof reply !== "string" && reply.buttons?.flat().map(button => button.data)).toEqual(["1", "/cancel"]);
});

it("меню сотрудника открывает финансовые обязанности кнопкой", () => {
  const reply = navigationReply("Справка", "tasks", "kk", undefined, "/start");
  expect(typeof reply !== "string" && reply.buttons?.flat().some(b => b.data === "/financialduties")).toBe(true);
});
