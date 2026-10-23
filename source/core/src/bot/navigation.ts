import type { TemplateStore } from "../templates/store.ts";
import { menuCommand } from "./help.ts";
import { messageButton } from "../templates/message.ts";
import { type BotReply, btn, type InlineButton } from "./keyboard.ts";
import type { Lang } from "./text.ts";
/** Shared transport decoration: every plain prompt has an escape via buttons. */
export function navigationReply(
  reply: BotReply,
  scenario: string,
  lang: Lang,
  store?: TemplateStore,
  input = "",
): BotReply {
  const command = menuCommand(input, store) ?? input.trim();
  const existing = typeof reply === "string"
    ? []
    : reply.buttons?.map((row) => [...row]) ?? [];
  if (scenario === "staff-requests" && typeof reply !== "string") return reply;
  const b = (id: string, cmd: string) =>
    btn(messageButton(store, lang, "bot.controls", id), cmd);
  const mainMenu = ["/start", "/cancel"].includes(command);
  const rows: InlineButton[][] = existing.length ? existing : command === "/help" ? [[b("start", "/start")]] : mainMenu ? [
    scenario === "tasks"
      ? [
        b("back", "/tasks"),
        b("staffrequests", "/staffrequests"),
        b("settings", "/notifications"),
      ]
      : [
        b("status", "/status"),
        b("register", "/register"),
        b("help", "/help"),
      ],
  ] : [];
  if (
    scenario === "registration" && !existing.length &&
    ["/start", "/cancel"].includes(command)
  ) {
    rows.push(
      [b("objects", "/objects"), b("add", "/add")],
      [b("requests", "/requests"), b("newrequest", "/newrequest")],
      [b("invite", "/invite"), b("accesses", "/accesses")],
      [b("incidents", "/incidents"), b("publications", "/publications")],
      [b("documents", "/documents"), b("financial", "/financial")],
      [b("polls", "/polls"),b("initiatives","/initiatives")],
      [b("emergency", "/emergency"), b("settings", "/notifications")],
    );
  }
  if(scenario==='registration'&&!existing.length&&['/start','/cancel'].includes(command))rows.push([b('pending','/pending')]);
  if(scenario==='tasks'&&!existing.length&&['/help','/start','/cancel'].includes(command))rows.push([b('signals','/signals'),b('publications','/publications')],[b('incidents','/incidents'),b('emergency','/emergency')]);
  if(scenario==='tasks'&&!existing.length&&['/help','/start','/cancel'].includes(command))rows.push([b('documents','/documents'),b('financialduties','/financialduties')]);
  if(scenario==="tasks"&&mainMenu&&!existing.length)rows.push([btn(messageButton(store,lang,"reports.controls","mywork"),"/mywork")]);
  if(scenario==="registration"&&mainMenu&&!existing.length)rows.push([btn(messageButton(store,lang,"reports.controls","plans"),"/plans")]);
  if (
    !rows.flat().some((b) =>
      b.data === "/cancel" || b.data === "/requestcancel"
    )
  ) rows.push([b("cancel", "/cancel")]);
  return {
    ...(typeof reply === "string" ? { text: reply } : reply),
    buttons: rows,
  };
}
