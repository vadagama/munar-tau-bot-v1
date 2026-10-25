import type { TemplateDef } from "./types.ts";
export const documentTemplates: readonly TemplateDef[] = [{
  key: "notices.documents.obligation", section: "notices", title: "Просрочено документальное обязательство",
  scenario: "Документы · Обязательства", description: "Напоминание ответственному и эскалация председателю без автоматического переноса срока.",
  variables: [{ name: "due_at", description: "Первоначальный срок Алматы", example: "23.10.2026 15:00" }],
  ru: "Не завершено документальное обязательство. Срок: {due_at}. Откройте очередь документов в кабинете.",
  kk: "Құжат дайындау міндеттемесі орындалмаған. Мерзімі: {due_at}. Кабинеттегі құжаттар кезегін ашыңыз.",
}, {
  key: "notices.documents.changed", section: "notices", title: "Изменение документа",
  scenario: "Документы · Проверка", description: "Уведомление подготовителю или проверяющему; доступ повторно проверяется перед доставкой.",
  variables: [{ name: "title", description: "Название документа", example: "Акт работы" },
    { name: "state_ru", description: "Состояние ru", example: "На проверке" },
    { name: "state_kk", description: "Состояние kk", example: "Тексеруде" }],
  ru: "Документ «{title}»: {state_ru}. Откройте раздел документов для просмотра.",
  kk: "«{title}» құжаты: {state_kk}. Қарау үшін құжаттар бөлімін ашыңыз.",
}];
