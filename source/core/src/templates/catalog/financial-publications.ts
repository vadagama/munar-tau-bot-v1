import type { TemplateDef } from "./types.ts";
const variables = [
  { name: "title", description: "Название выпуска", example: "Финансовый отчёт" },
  { name: "version", description: "Версия комплекта", example: "2" },
  { name: "period_from", description: "Начало периода", example: "01.09.2026" },
  { name: "period_to", description: "Конец периода", example: "30.09.2026" },
  { name: "correction_note", description: "Публичное пояснение исправления", example: "Уточнено приложение" },
];
const buttons = [{ id: "open", ru: "Открыть выпуск", kk: "Жарияланымды ашу" }];
export const financialPublicationTemplates: readonly TemplateDef[] = [{
  key: "notices.financial.published", section: "notices", title: "Опубликован финансовый отчёт", scenario: "Финансовые публикации",
  description: "Уведомление собственнику о конкретной выпущенной версии; доступ проверяется перед доставкой.", variables, buttons,
  ru: "Опубликован «{title}». Версия {version}, период {period_from} — {period_to}. Доступный комплект и архив находятся в карточке выпуска.",
  kk: "«{title}» жарияланды. {version}-нұсқа, кезеңі: {period_from} — {period_to}. Қолжетімді құжаттар мен мұрағат жарияланым карточкасында.",
}, {
  key: "notices.financial.corrected", section: "notices", title: "Исправлен финансовый отчёт", scenario: "Финансовые публикации",
  description: "Новая версия и публичная поправка; прежний выпуск остаётся в архиве.", variables, buttons,
  ru: "Опубликовано исправление «{title}». Версия {version}, период {period_from} — {period_to}.\nПояснение: {correction_note}\nПрежняя опубликованная версия сохранена в архиве.",
  kk: "«{title}» түзетуі жарияланды. {version}-нұсқа, кезеңі: {period_from} — {period_to}.\nТүсіндірме: {correction_note}\nБұрын жарияланған нұсқа мұрағатта сақталған.",
}];
