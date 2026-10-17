export const TASK_STATE_TEXT: Record<string,string> = {
  created:"Создано",awaiting_acceptance:"Ожидает принятия",accepted:"Принято",in_progress:"Выполняется",
  suspended:"Приостановлено",on_review:"На проверке",rework:"На доработке",accepted_admin:"Принято администратором",canceled:"Отменено",
};
export const TASK_ACTION_TEXT: Record<string,string> = {
  created:"Создано",assigned:"Назначено",assign:"Назначить",accept:"Принять",decline:"Не могу выполнить",start:"Начать работу",
  suspend:"Приостановить",resume:"Возобновить",reassign:"Снять назначение",cancel:"Отменить",report:"Отчёт отправлен",approve:"Принять результат",return:"Вернуть на доработку",
};
