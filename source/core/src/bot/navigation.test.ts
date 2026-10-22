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
    ["/incidents", "/publications"], ["/emergency", "/notifications"],
    ["/pending"], ["/cancel"],
  ]);
});
it("справка предлагает вернуться на старт", () => {
  const reply = navigationReply("Справка", "registration", "ru", undefined, "/help");
  if (typeof reply === "string") throw new Error("Ожидалась навигация");
  expect(reply.buttons).toEqual([[{ text: "Старт", data: "/start" }], [{ text: "Отменить", data: "/cancel" }]]);
  expect(menuCommand("Старт")).toBe("/start");
});
