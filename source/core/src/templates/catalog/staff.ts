import type { TemplateDef } from "./types.ts";
export const staffTemplates: readonly TemplateDef[] = [{
  key: "notices.staff.roles_changed",
  section: "notices",
  title: "Изменение служебных ролей",
  scenario: "Уведомления · Служебные роли",
  description:
    "Обязательное личное уведомление о служебных полномочиях, включая их прекращение.",
  variables: [
    {
      name: "before_ru",
      description: "Прежние роли (ru)",
      example: "Исполнитель",
    },
    {
      name: "before_kk",
      description: "Прежние роли (kk)",
      example: "Орындаушы",
    },
    { name: "after_ru", description: "Новые роли (ru)", example: "Дежурный" },
    { name: "after_kk", description: "Новые роли (kk)", example: "Кезекші" },
    {
      name: "actor_name",
      description: "Кто изменил",
      example: "Администратор ОСИ",
    },
    {
      name: "at",
      description: "Дата и время Алматы",
      example: "18.10.2026 15:00",
    },
    {
      name: "reason",
      description: "Причина",
      example: "Изменение обязанностей",
    },
  ],
  ru:
    "Ваши служебные роли изменены.\nБыло: {before_ru}\nСтало: {after_ru}\nИзменил: {actor_name}\nДата: {at}\nПричина: {reason}",
  kk:
    "Қызметтік рөлдеріңіз өзгертілді.\nБұрын: {before_kk}\nҚазір: {after_kk}\nӨзгерткен: {actor_name}\nКүні: {at}\nСебебі: {reason}",
}];
