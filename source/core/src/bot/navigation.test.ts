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
it.each(["registration", "tasks"])("справка %s не содержит кнопок", scenario => {
  expect(navigationReply("Справка", scenario, "ru", undefined, "/help")).toBe("Справка");
  expect(menuCommand("Старт")).toBe("/start");
});
