import type { TemplateStore } from "../templates/store.ts";
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
  const existing = typeof reply === "string"
    ? []
    : reply.buttons?.map((row) => [...row]) ?? [];
  if (scenario === "staff-requests" && typeof reply !== "string") return reply;
  const b = (id: string, cmd: string) =>
    btn(messageButton(store, lang, "bot.controls", id), cmd);
  const rows: InlineButton[][] = existing.length ? existing : [
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
  ];
  if (
    scenario === "registration" && !existing.length &&
    ["/help", "/start", "/cancel"].includes(input.trim())
  ) {
    rows.push(
      [b("objects", "/objects"), b("add", "/add")],
      [b("requests", "/requests"), b("newrequest", "/newrequest")],
      [b("invite", "/invite"), b("accesses", "/accesses")],
      [b("incidents", "/incidents"), b("publications", "/publications")],
      [b("emergency", "/emergency"), b("settings", "/notifications")],
    );
  }
  if(scenario==='registration'&&!existing.length&&['/help','/start','/cancel'].includes(input.trim()))rows.push([b('pending','/pending')]);
  if(scenario==='tasks'&&!existing.length&&['/help','/start','/cancel'].includes(input.trim()))rows.push([b('signals','/signals'),b('publications','/publications')],[b('incidents','/incidents'),b('emergency','/emergency')]);
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
