/**
 * Контекстные подсказки бота (срез UX A): вместо полной простыни команд в
 * каждой реплике — только действия, доступные в текущем состоянии. Полная
 * справка — по /help. Тексты сдвоенные «ru / kk» до среза локализации.
 */
import { cmd } from "./text.ts";

/** Полная справка бота: разделы команд, экстренная строка. */
export function registrationHelp(): string {
  return [
    "<b>ОСИ ЖК «Мунар Тау»</b>",
    `<b>Обращения:</b> ${cmd("/newrequest")} — новое; ${cmd("/requests")} — мои; ${cmd("/request НОМЕР")} — открыть; ${cmd("/say НОМЕР текст")} — сообщение`,
    `<b>Задания исполнителя:</b> ${cmd("/tasks")}; ${cmd("/task НОМЕР")}`,
    `<b>Регистрация:</b> ${cmd("/register")}; ${cmd("/add")} — новый объект; ${cmd("/status")} — анкеты; ${cmd("/objects")} — объекты`,
    `<b>Доступы собственника:</b> ${cmd("/pending")}; ${cmd("/accesses")}; ${cmd("/invite")} — пригласить; ${cmd("/approve")}, ${cmd("/reject")}, ${cmd("/dispute")}, ${cmd("/revoke")} — решения`,
    `<b>Настройки:</b> ${cmd("/notifications")} — уведомления и язык`,
    "При непосредственной угрозе жизни звоните 112 / Өмірге тікелей қауіп төнсе 112 нөміріне қоңырау шалыңыз.",
  ].join("\n");
}

/** Подсказки по карточке обращения в зависимости от состояния. */
export function requestActions(state: unknown, isDraft = false): string {
  const actions: string[] = isDraft
    ? [`${cmd("/sendrequest")} — отправить; ${cmd("/editrequest")} — текст; ${cmd("/deletedraft")} — удалить; файлы — просто прикрепите к следующему сообщению`]
    : [];
  switch (String(state)) {
    case "new":
    case "reviewing":
    case "need_clarification":
    case "in_work":
    case "on_hold":
      actions.push(`${cmd("/visits НОМЕР")} — визиты; ${cmd("/say НОМЕР текст")} — сообщение`);
      break;
    case "awaiting_confirmation":
      actions.push(`${cmd("/result НОМЕР")} — отчёты; ${cmd("/confirm НОМЕР ВЕРСИЯ")} — принять; ${cmd("/return НОМЕР причина")} — доработка`);
      break;
    case "closed":
      actions.push(`${cmd("/rate НОМЕР 1–5 комментарий")} — оценка; ${cmd("/appeal НОМЕР причина")}`);
      break;
    case "canceled":
    case "rejected":
      actions.push(`${cmd("/appeal НОМЕР причина")} — апелляция; ${cmd("/reopen НОМЕР причина")}`);
      break;
    default:
      break;
  }
  return actions.length ? `Действия: ${actions.join("; ")}` : "";
}

/** Подсказки по карточке задания в зависимости от состояния. */
export function taskActions(state: unknown): string {
  const a = cmd;
  switch (String(state)) {
    case "awaiting_acceptance":
      return `Действия: ${a("/accepttask НОМЕР")} — принять; ${a("/declinetask НОМЕР причина")} — не могу`;
    case "accepted":
      return `Действия: ${a("/starttask НОМЕР")} — начать работу`;
    case "in_progress":
      return `Действия: ${a("/reporttask НОМЕР")} — отчёт; ${a("/proposevisit НОМЕР")} — визит; ${a("/pausetask НОМЕР причина")} — остановка; ${a("/problem НОМЕР …")} — найденная проблема`;
    case "suspended":
      return `Действия: ${a("/starttask НОМЕР")} — возобновить`;
    case "rework":
      return `Действия: ${a("/starttask НОМЕР")} — продолжить после доработки`;
    case "on_review":
      return "Отчёт на проверке у администратора.";
    default:
      return "";
  }
}
