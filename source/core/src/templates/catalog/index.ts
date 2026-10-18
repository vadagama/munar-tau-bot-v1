import { commonTemplates } from "./common.ts";
import { noticesTemplates } from "./notices.ts";
import { notificationsTemplates } from "./notifications.ts";
import { requestsTemplates } from "./requests.ts";
import { inboundTemplates } from "./inbound.ts";
import { helpTemplates } from "./help.ts";
import { request_textTemplates } from "./request-text.ts";
import { request_filesTemplates } from "./request-files.ts";
import { incidentsTemplates } from "./incidents.ts";
import { tasksTemplates } from "./tasks.ts";
import { registrationTemplates } from "./registration.ts";
import { errors } from "./errors.ts";
import type { TemplateDef } from "./types.ts";
export const TEMPLATE_CATALOG: readonly TemplateDef[] = [
  ...errors,
  ...commonTemplates,
  ...noticesTemplates,
  ...notificationsTemplates,
  ...requestsTemplates,
  ...inboundTemplates,
  ...helpTemplates,
  ...request_textTemplates,
  ...request_filesTemplates,
  ...incidentsTemplates,
  ...tasksTemplates,
  ...registrationTemplates,
  {
    key: "common.error_help",
    section: "common",
    title: "Подсказка после ошибки",
    description: "Ссылка на справку после ошибки",
    variables: [],
    ru: "/help — все команды",
    kk: "/help — барлық командалар",
  },
];
const byKey = new Map(TEMPLATE_CATALOG.map((def) => [def.key, def]));
export function getTemplate(key: string): TemplateDef | undefined {
  return byKey.get(key);
}
