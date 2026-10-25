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
  registered = false,
): BotReply {
  const command = menuCommand(input, store) ?? input.trim();
  const existing = typeof reply === "string"
    ? []
    : reply.buttons?.map((row) => [...row]) ?? [];
  if (scenario === "staff-requests" && typeof reply !== "string") return reply;
  const b = (id: string, cmd: string) =>
    btn(messageButton(store, lang, "bot.controls", id), cmd);
  const worker = scenario === "tasks";
  const mainMenu = ["/start", "/cancel"].includes(command);
  const rows: InlineButton[][] = existing.length ? existing : [];
  if (!rows.length && mainMenu) {
    if (worker) {
      rows.push(
        [b("back", "/tasks"), b("staffrequests", "/staffrequests"), b("settings", "/notifications")],
        [b("signals", "/signals"), b("financialduties", "/financialduties")],
        [btn(messageButton(store, lang, "reports.controls", "mywork"), "/mywork")],
      );
    } else {
      // Главное меню жителя (25.10.2026): разделы кнопками, «Мой профиль» —
      // только в нативном меню /status. «Отменить» не нужна: /cancel и /start
      // здесь открывают это же меню.
      rows.push(
        ...(registered ? [] : [[b("register", "/register")]] as InlineButton[][]),
        [b("requests", "/requests"), b("newrequest", "/newrequest")],
        [b("objects", "/objects"), b("add", "/add")],
        [b("invite", "/invite"), b("bind", "/bind"), b("accesses", "/accesses")],
        [b("settings", "/notifications")],
        [b("help", "/help")],
      );
    }
  }
  const cancelLabel = messageButton(store, lang, "bot.controls", "cancel");
  const escapePresent = rows.flat().some((x) =>
    x.data === "/cancel" || x.data === "/requestcancel" ||
    x.text === cancelLabel
  );
  if (worker) {
    // Подпись отмены локализована; кнопка формы с той же подписью означает тот
    // же выход из диалога — вторая такая же рядом неразличима для пользователя.
    if (!escapePresent) rows.push([b("cancel", "/cancel")]);
  } else if (!escapePresent) {
    // У жителя вторичные экраны закрываются явной кнопкой «В главное меню»:
    // /cancel в жительском боте всегда ведёт в главное меню. В формах ввода
    // остаётся их собственная «Отменить» — подпись совпадает и не дублируется.
    if (mainMenu && !existing.length) {
      // Незарегистрированному в главном меню — путь к анкете.
      if (!registered && !rows.some((r) => r.some((x) => x.data === "/register"))) {
        rows.push([b("register", "/register")]);
      }
    } else {
      rows.push([btn(messageButton(store, lang, "bot.controls", "menu"), "/cancel")]);
    }
  }
  return {
    ...(typeof reply === "string" ? { text: reply } : reply),
    buttons: rows,
  };
}
