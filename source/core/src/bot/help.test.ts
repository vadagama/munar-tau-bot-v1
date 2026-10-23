import { describe, expect, it } from "vitest";
import { menuCommand, registrationHelp, workerHelp } from "./help.ts";

describe("справка по командам", () => {
  it.each(["ru", "kk"] as const)("житель получает группы и описания команд (%s)", lang => {
    const text = registrationHelp(lang);
    for (const command of ["register", "status", "objects", "add", "requests", "newrequest", "publications", "notifications", "cancel", "help", "documents", "financial", "polls", "initiatives", "plans"]) {
      expect(text).toMatch(new RegExp(`/${command} — .+`));
    }
    expect(text).toContain(lang === "ru" ? "<b>Регистрация</b>" : "<b>Тіркелу</b>");
    expect(text).toContain(lang === "ru" ? "<b>Обращения</b>" : "<b>Өтініштер</b>");
    expect(text).not.toContain("/staffrequests");
    expect(text).not.toContain("/tasks");
  });
  it.each(["ru", "kk"] as const)("сотрудник получает собственные группы (%s)", lang => {
    const text = workerHelp(lang);
    for (const command of ["staffrequests", "tasks", "notifications", "help", "cancel", "mywork", "documents", "financialduties", "polls", "initiatives"]) {
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
