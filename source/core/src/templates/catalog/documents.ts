import type { TemplateDef } from "./types.ts";
export const documentTemplates: readonly TemplateDef[] = [{
  key: "notices.documents.changed", section: "notices", title: "Изменение документа",
  scenario: "Документы · Проверка", description: "Уведомление подготовителю или проверяющему; доступ повторно проверяется перед доставкой.",
  variables: [{ name: "title", description: "Название документа", example: "Акт работы" },
    { name: "state_ru", description: "Состояние ru", example: "На проверке" },
    { name: "state_kk", description: "Состояние kk", example: "Тексеруде" }],
  ru: "Документ «{title}»: {state_ru}. Откройте раздел документов для просмотра.",
  kk: "«{title}» құжаты: {state_kk}. Қарау үшін құжаттар бөлімін ашыңыз.",
}];
