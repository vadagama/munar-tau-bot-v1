import { describe, expect, it } from "vitest";
import { menuCommand, registrationHelp, workerHelp } from "./help.ts";

describe("справка по командам", () => {
  it.each(["ru", "kk"] as const)("житель получает группы и описания команд (%s)", lang => {
    const text = registrationHelp(lang);
    expect(text.startsWith("<b>❓")).toBe(true);
    expect(text).not.toMatch(/\/start(?:\s|$)/);
    expect(text).not.toContain("/cancel");
    expect(text).not.toContain("Действия с обращением доступны в его карточке.");
    const headings = [...text.matchAll(/<b>([^<]+)<\/b>/g)].slice(1).map(m => m[1]);
    expect(headings).toEqual(lang === "ru"
      ? ["Регистрация", "Помещения", "Обращения", "Доступы собственника", "Новости и аварии", "Настройки и навигация"]
      : ["Тіркелу", "Үй-жайлар", "Өтініштер", "Меншік иесінің рұқсаттары", "Жаңалықтар мен апаттар", "Баптаулар мен навигация"]);
    expect(text.split("\n").filter(line => /\/[a-z]+(?:\s|$)/.test(line)).every(line => line.startsWith("• "))).toBe(true);

    for (const command of ["register", "status", "objects", "add", "requests", "newrequest", "publications", "notifications", "help"]) {
      expect(text).toMatch(new RegExp(`/${command} — .+`));
    }
    expect(text).toContain(lang === "ru" ? "<b>Регистрация</b>" : "<b>Тіркелу</b>");
    expect(text).toContain(lang === "ru" ? "<b>Обращения</b>" : "<b>Өтініштер</b>");
    expect(text).not.toContain("/staffrequests");
    expect(text).not.toContain("/tasks");
  });
  it.each(["ru", "kk"] as const)("сотрудник получает собственные группы (%s)", lang => {
    const text = workerHelp(lang);
    expect(text.startsWith("<b>❓")).toBe(true);
    expect(text).not.toMatch(/\/start(?:\s|$)/);
    expect(text).not.toContain("/cancel");
    expect([...text.matchAll(/<b>([^<]+)<\/b>/g)].slice(1).every(m => !/\p{Extended_Pictographic}/u.test(m[1]!))).toBe(true);
    expect(text.split("\n").filter(line => /\/[a-z]+(?:\s|$)/.test(line)).every(line => line.startsWith("• "))).toBe(true);

    for (const command of ["staffrequests", "tasks", "notifications", "help"]) {
      expect(text).toMatch(new RegExp(`/${command} — .+`));
    }
    expect(text).toContain(lang === "ru" ? "<b>Задания</b>" : "<b>Тапсырмалар</b>");
    expect(text).not.toContain("/newrequest");
    expect(text).not.toContain("/register");
  });
  it("кнопки Помощь на обоих языках ведут в /help", () => {
    expect(menuCommand("❓ Помощь")).toBe("/help");
    expect(menuCommand("❓ Анықтама")).toBe("/help");
  });
});
