import { templateNotice } from "../templates/notice.ts";
export type LocalizedNotice = { ru: string; kk: string };
export function authorReminder(number: unknown): ReturnType<typeof templateNotice> {
  return templateNotice("notices.locales_notifications_author_reminder_1", {number: number});
}
export function adminCheck(number: unknown): ReturnType<typeof templateNotice> {
  return templateNotice("notices.locales_notifications_admin_check_2", {number: number});
}
export function deliveryFailed(number: unknown): ReturnType<typeof templateNotice> {
  return templateNotice("notices.locales_notifications_delivery_failed_3", {number: number});
}
export function firstResponseOverdue(number: unknown): ReturnType<typeof templateNotice> {
  return templateNotice("notices.locales_notifications_first_response_overdue_4", {number: number});
}
export function nextActionReminder(number: unknown): ReturnType<typeof templateNotice> {
  return templateNotice("notices.locales_notifications_next_action_reminder_5", {number: number});
}
