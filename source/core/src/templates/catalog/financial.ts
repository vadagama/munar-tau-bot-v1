import type { TemplateDef } from "./types.ts";
export const financialTemplates: readonly TemplateDef[] = [{
  key: "notices.financial.obligation", section: "notices", title: "Просрочена обязанность по финансовому отчёту",
  scenario: "Финансовые публикации · Обязательства", description: "Напоминание ответственным и эскалация председателю; исходный срок сохраняется.",
  variables: [{ name: "due_at", description: "Первоначальный срок Алматы", example: "23.10.2026 15:00" }],
  ru: "Не завершена обязанность по финансовому отчёту. Срок: {due_at}. Откройте очередь финансовых отчётов в кабинете.",
  kk: "Қаржылық есеп бойынша міндеттеме орындалмаған. Мерзімі: {due_at}. Кабинеттегі қаржылық есептер кезегін ашыңыз.",
}];
