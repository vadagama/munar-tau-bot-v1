/** Подписи состояний задания: бот берёт по языку профиля, кабинет — ru. */
export const TASK_STATE_TEXT: Record<string, { ru: string; kk: string }> = {
  created: { ru: "Создано", kk: "Құрылды" },
  awaiting_acceptance: { ru: "Ожидает принятия", kk: "Қабылдауды күтуде" },
  accepted: { ru: "Принято", kk: "Қабылданды" },
  in_progress: { ru: "Выполняется", kk: "Орындалуда" },
  suspended: { ru: "Приостановлено", kk: "Кідіртілді" },
  on_review: { ru: "На проверке", kk: "Тексеруде" },
  rework: { ru: "На доработке", kk: "Түзетуде" },
  accepted_admin: { ru: "Принято администратором", kk: "Әкімші қабылдады" },
  canceled: { ru: "Отменено", kk: "Болдырылмады" },
};

/**
 * Задание в активной работе исполнителя: тот же набор, по которому визиты
 * разрешают no_access/no_show (domains/tasks/visits.ts). Визиты и аварийный
 * сигнал показываются на карточке только для этих состояний.
 */
export const TASK_ACTIVE_WORK_STATES: readonly string[] = [
  "accepted",
  "in_progress",
  "suspended",
  "rework",
];

/** Подпись состояния задания на языке получателя. */
export function taskStateText(state: unknown, lang: "ru" | "kk"): string {
  return TASK_STATE_TEXT[String(state)]?.[lang] ?? String(state ?? "");
}

/** Подпись состояния визита исполнителя (bot/tasks, bot/requests). */
export const VISIT_STATE_TEXT: Record<string, { ru: string; kk: string }> = {
  proposed: { ru: "Предложен", kk: "Ұсынылған" },
  confirmed: { ru: "Согласован", kk: "Келісілген" },
  missed: { ru: "Не состоялся", kk: "Өтпеген" },
  rescheduled: { ru: "Перенесён", kk: "Ауыстырылған" },
};
export function visitStateText(state: unknown, lang: "ru" | "kk"): string {
  return VISIT_STATE_TEXT[String(state)]?.[lang] ?? String(state ?? "");
}

/** Подписи состояний общей работы для уведомлений жителям. */
export const COMMON_WORK_STATE_TEXT: Record<string, { ru: string; kk: string }> = {
  planned: { ru: "запланирована", kk: "жоспарланған" },
  in_progress: { ru: "выполняется", kk: "орындалуда" },
  on_review: { ru: "на проверке", kk: "тексеруде" },
  completed: { ru: "завершена", kk: "аяқталды" },
  canceled: { ru: "отменена", kk: "болдырылмады" },
};
export const TASK_ACTION_TEXT: Record<string, string> = {
  replace_canceled: "Заменить отменённое задание",
  request_pause: "Запросить остановку",
  revise_template: "Обновить методичку",
  created: "Создано",
  assigned: "Назначено",
  assign: "Назначить",
  accept: "Принять",
  decline: "Не могу выполнить",
  start: "Начать работу",
  suspend: "Приостановить",
  resume: "Возобновить",
  reassign: "Снять назначение",
  cancel: "Отменить",
  report: "Отчёт отправлен",
  approve: "Принять результат",
  return: "Вернуть на доработку",
};
