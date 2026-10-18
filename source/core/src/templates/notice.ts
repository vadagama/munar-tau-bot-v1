import { t, type TemplateStore } from "./store.ts";
import type { Lang } from "../bot/text.ts";
export interface TemplateNotice {
  template: string;
  vars: Record<string, unknown>;
}
export type NoticeText = string | { ru: string; kk: string } | TemplateNotice;
export function templateNotice(
  template: string,
  vars: Record<string, unknown> = {},
): TemplateNotice {
  return { template, vars };
}
export function renderNotice(
  message: NoticeText,
  lang: Lang,
  store?: TemplateStore,
): string {
  if (typeof message === "string") return message;
  return "template" in message
    ? t(store, lang, message.template, message.vars)
    : message[lang];
}
