import { menuCommand, residentMenu, workerMenu } from "./help.ts";
import { type BotReply, replyText } from "./keyboard.ts";
import type { Lang } from "./text.ts";
import type { TemplateStore } from "../templates/store.ts";

/** Меню Telegram с явным сценарием для транспорта симулятора. */
export function withSimulatorMenu(reply: BotReply, scenario: string, lang: Lang, templates: TemplateStore): BotReply {
  const scenarios: Record<string, string> = {
    "/polls": "polls",
    "/initiatives":"initiatives",
    "/documents": "documents",
    "/newrequest": "requests", "/requests": "requests", "/objects": "registration",
    "/staffrequests":"staff-requests", "/add": "registration", "/notifications": "notifications", "/tasks": "tasks",
    "/help": scenario === "tasks" ? "tasks" : "registration",
  };
  const menu = ["tasks","staff-requests"].includes(scenario) ? workerMenu(lang, templates) : residentMenu(lang, templates);
  return {
    ...(typeof reply === "string" ? { text: replyText(reply) } : reply),
    menu: menu.map(row => row.map(text => {
      const data = menuCommand(text, templates)!;
      return { text, data, scenario: scenarios[data]! };
    })),
  };
}
