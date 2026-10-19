import { menuCommand, residentMenu, workerMenu } from "./help.ts";
import { type BotReply, replyText } from "./keyboard.ts";
import type { Lang } from "./text.ts";
import type { TemplateStore } from "../templates/store.ts";

/** Меню Telegram с явным сценарием для транспорта симулятора. */
export function withSimulatorMenu(reply: BotReply, scenario: string, lang: Lang, templates: TemplateStore): BotReply {
  const scenarios: Record<string, string> = {
    "/newrequest": "requests", "/requests": "requests", "/objects": "registration",
    "/add": "registration", "/notifications": "notifications", "/tasks": "tasks",
    "/help": scenario === "tasks" ? "tasks" : "registration",
  };
  const menu = scenario === "tasks" ? workerMenu(lang, templates) : residentMenu(lang, templates);
  return {
    ...(typeof reply === "string" ? { text: replyText(reply) } : reply),
    menu: menu.map(row => row.map(text => {
      const data = menuCommand(text, templates)!;
      return { text, data, scenario: scenarios[data]! };
    })),
  };
}
