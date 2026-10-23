import { initiativeTemplates,initiativeDialogTemplates } from "./initiatives.ts";
import { pollTemplates, pollDialogTemplates } from "./polls.ts";
import { botUiTemplates } from "./bot-ui.ts";
import { documentTemplates } from "./documents.ts";
import { financialTemplates } from "./financial.ts";
import { financialPublicationTemplates } from "./financial-publications.ts";
import { financialDialogTemplates } from "./financial-dialogs.ts";
import { documentDialogTemplates } from "./document-dialogs.ts";
import { staffRequestTemplates } from "./staff-requests.ts";
import { staffTemplates } from "./staff.ts";
import { requestsMessageTemplates } from "./messages-requests.ts";
import { registrationTasksMessageTemplates } from "./messages-registration-tasks.ts";
import { otherMessageTemplates } from "./messages-other.ts";
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
const legacyCatalog: readonly TemplateDef[] = [
  ...documentTemplates,
  ...financialTemplates,
  ...financialPublicationTemplates,
  ...pollTemplates,
  ...initiativeTemplates,
  ...initiativeDialogTemplates,
  ...pollDialogTemplates,
  ...staffTemplates,
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
const messages = [
  ...financialDialogTemplates,
  ...documentDialogTemplates,
  ...staffRequestTemplates,
  ...botUiTemplates,
  ...requestsMessageTemplates,
  ...registrationTasksMessageTemplates,
  ...otherMessageTemplates,
];
const consumed = new Set(messages.flatMap((def) => def.legacyKeys ?? []));
const replacements = new Map(messages.map((def) => [def.key, def]));
export const TEMPLATE_CATALOG: readonly TemplateDef[] = [
  ...messages,
  ...legacyCatalog.filter((def) => !replacements.has(def.key)).map((def) => ({
    ...def,
    deprecated: def.section !== "notices" || consumed.has(def.key),
  })),
];
const byKey = new Map(TEMPLATE_CATALOG.map((def) => [def.key, def]));
export function getTemplate(key: string): TemplateDef | undefined {
  return byKey.get(key);
}
