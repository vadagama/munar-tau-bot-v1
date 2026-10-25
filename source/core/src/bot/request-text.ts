import { message, messageButton, safeBlock } from "../templates/message.ts";
import { t as templateText, type TemplateStore } from "../templates/store.ts";
import { requestStateText } from "../locales/requests.ts";
import type { Row } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { type BotReply, btn, type InlineButton } from "./keyboard.ts";
import { esc, fmtDate, fmtDay, type Lang, numbered } from "./text.ts";

/** Telegram sendMessage: 4096 символов. Не разрываем последнюю суррогатную пару. */
export function preview(value: unknown, limit: number): string {
  const text = String(value ?? "");
  return text.length <= limit
    ? text
    : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

export function requestListText(
  rows: Row[],
  personId: string,
  page: number,
  lang: Lang = "ru",
  store?: TemplateStore,
  residentBotUsername?: string,
  view: { archive?: boolean; hasArchive?: boolean } = {},
  counts: { active: number; action: number } = { active: 0, action: 0 },
): BotReply {
  // Username бота жителя для глубокой ссылки из списка: из среды или фолбэк
  // по фактически созданному боту (ADR-009; @munar_tau_bot не существует).
  const username = residentBotUsername ?? "munar_tau_user_bot";
  if (!/^[A-Za-z0-9_]+$/.test(username)) throw new ApiError("INTERNAL");
  const visible = rows.slice(0, 10);
  const list = visible.map((r) =>
    `<b>${r.state!=='draft' && /^[0-9a-f-]{36}$/i.test(String(r.id)) ? `<a href="https://t.me/${username}?start=req_${r.id}">${esc(r.number)}</a>` : (r.number
      ? esc(r.number)
      : templateText(store, lang, "requests.chernovik"))}</b>${
      r.state === "draft"
        ? ""
        : ` · ${esc(requestStateText(r.state, lang))} · ${
          esc(fmtDay(r.created_at))
        }`
    }${
      r.can_manage !== true && r.author_person_id !== personId
        ? ` · ${templateText(store, lang, "requests.sovmestnoe")}`
        : ""
    }\n${esc(preview(r.description, 120))}`
  );
  // Подзаголовок вида списка и строка «требуют ответа» — слова из каталога.
  const scope = view.archive
    ? messageButton(store, lang, "message.requests.list", "archive").toLowerCase()
    : message(store, lang, "requests.list_scope_active", { count: counts.active });
  const action = !view.archive && counts.action > 0
    ? `\n\n${message(store, lang, "requests.list_action_needed", { count: counts.action })}`
    : "";
  const text = message(store, lang, "message.requests.list", {
    requests: safeBlock(
      list.length
        ? numbered(list)
        : templateText(store, lang, "requests.obrascheniy_net"),
    ),
    scope,
    action,
  });
  // Открытие — кнопкой в строке; у черновиков одна общая кнопка возобновления
  // мастера отправки вместо дублей на каждый черновик.
  const buttons: InlineButton[][] = [];
  if (visible.some((r) => r.state === "draft")) {
    buttons.push([
      btn(
        messageButton(store, lang, "message.requests.list", "open_draft"),
        "/newrequest",
      ),
    ]);
  }
  for (const r of visible) {
    if (r.state !== "draft" && !/^[0-9a-f-]{36}$/i.test(String(r.id))) {
      buttons.push([
        btn(
          messageButton(store, lang, "message.requests.list", "open", {
            number: String(r.number),
          }),
          `/request ${r.number}`,
        ),
      ]);
    }
  }
  // Пагинация остаётся внутри текущего вида (активные/архив), рядами по паре.
  const viewToken = view.archive ? "archive " : "";
  const nav: InlineButton[] = [];
  if (page > 1) {
    nav.push(
      btn(
        messageButton(store, lang, "bot.controls", "back"),
        `/requests ${viewToken}page:${page - 1}`,
      ),
    );
  }
  if (rows.length > 10) {
    nav.push(
      btn(
        messageButton(store, lang, "message.requests.list", "next"),
        `/requests ${viewToken}page:${page + 1}`,
      ),
    );
  }
  if (nav.length) buttons.push(nav);
  if (view.archive) {
    // Выход из архива к активным; подпись отличается от кнопки пагинации.
    buttons.push([
      btn(messageButton(store, lang, "message.requests.list", "active"), "/requests"),
    ]);
  } else {
    // Архив — только когда закрытые обращения уже есть.
    if (view.hasArchive) {
      buttons.push([
        btn(
          messageButton(store, lang, "message.requests.list", "archive"),
          "/requests archive",
        ),
      ]);
    }
    // Пустой список — путь к действию вместо тупика.
    if (!visible.length) {
      buttons.push([
        btn(messageButton(store, lang, "bot.controls", "newrequest"), "/newrequest"),
      ]);
    }
  }
  return { text, buttons };
}

export function requestCardText(
  row: Row,
  lang: Lang = "ru",
  store?: TemplateStore,
): BotReply {
  const messages = (row.messages as Row[]).filter((m) =>
    m.channel === "resident"
  ).slice(-3);
  const result = (row.confirmation as Row | undefined)?.payload as
    | Row
    | undefined;
  const reports = (result?.task_results as Row[]) ?? [];
  // Файлы сообщения показываются строкой «📎 имя» под текстом сообщения.
  const attachments = (row.attachments as Row[] | undefined) ?? [];
  const attachmentLines = (m: Row): string => attachments
    .filter((a) => a.owner_type === 'message' && a.owner_id === m.id)
    .map((a) => '📎 ' + esc(preview(String(a.filename ?? ''), 40)))
    .join('\n');
  const authorLabel = (m: Row): string => {
    if (m.author_person_id === row.author_person_id) {
      return templateText(store, lang, "requests.vy");
    }
    return m.author_kind === "staff"
      ? templateText(store, lang, "requests.administrator")
      : templateText(store, lang, "requests.uchastnik");
  };
  const kind =
    ["new", "reviewing", "need_clarification", "in_work", "on_hold"].includes(
        String(row.state),
      )
      ? "active"
      : row.state === "awaiting_confirmation"
      ? "confirmation"
      : row.state === "closed"
      ? "closed"
      : ["canceled", "rejected"].includes(String(row.state))
      ? "rejected"
      : "other";
  const templateKey = `message.requests.card.${kind}`;
  // Метка вида — из словаря видов каталога; неизвестное значение БД (не должно
  // встречаться после CHECK) показывает «нет», а не ломает карточку.
  const kindLabel = (() => {
    try {
      return messageButton(store, lang, "message.requests.kind", String(row.kind ?? "request"));
    } catch {
      return templateText(store, lang, "requests.net");
    }
  })();
  const text = message(store, lang, templateKey, {
    number: row.number,
    state: requestStateText(row.state, lang),
    kind: kindLabel,
    place: row.place_label ?? preview(row.location_text, 120),
    created: fmtDate(row.created_at),
    description: preview(row.description, 600),
    messages: safeBlock(
      messages.length
        ? messages.map((m) => {
          const body = esc(preview(m.text, 400));
          const files = attachmentLines(m);
          return `${esc(fmtDate(m.created_at))} — ${authorLabel(m)}: ${body}${
            files && body ? '\n' : ''
          }${files}`;
        }).join('\n')
        : "—",
    ),
    result: result ? `\n${preview(result.summary, 600)}` : "",
    reports: reports.length
      ? `\n${message(store, lang, "requests.otchety_stroka", {
        count: reports.length,
      })}`
      : "",
    report_count: reports.length,
    report_command: reports.length ? `/result ${row.number}` : "",
    rate_scale: row.state === "closed" && row.number && row.can_act_as_author !== false
      ? `\n\n${templateText(store, lang, "requests.rating_scale")}`
      : "",
  });
  // Кнопки — точные текстовые команды: нажатие обрабатывается как ввод команды.
  const buttons: InlineButton[][] = [];
  if (row.state === "awaiting_confirmation" && row.number && row.can_act_as_author!==false) {
    buttons.push([
      btn(
        messageButton(store, lang, templateKey, "confirm"),
        `/confirm ${row.number} ${row.confirmation_version}`,
      ),
    ]);
  }
  if (row.state === "closed" && row.number && row.can_act_as_author!==false) {
    buttons.push(
      [1, 2, 3, 4, 5].map((value) =>
        btn(
          messageButton(store, lang, templateKey, "rate", {
            value,
          }),
          `/rate ${row.number} ${value}`,
        )
      ),
    );
  }
  const control=(id:string,cmd=id)=>btn(messageButton(store,lang,'bot.controls',id),`/${cmd} ${row.number}`);
  // Аварийная служба убрана из интерфейса: экстренные сообщения — вид обращения
  // «Экстренная ситуация» в мастере /newrequest (25.10.2026).
  if(row.can_comment) buttons.push([control('say'),control('visits')]);
  if(reports.length)buttons.push([control('result')]);
  if(row.can_act_as_author) {
    if(row.state==='awaiting_confirmation')buttons.push([control('return')]);
    if(['new','reviewing','need_clarification','in_work','on_hold','rework'].includes(String(row.state)))buttons.push([control('cancelrequest')]);
    if(row.state==='rejected')buttons.push([control('appeal')]);
    if(['closed','canceled','rejected'].includes(String(row.state)))buttons.push([control('reopen')]);
  }
  if(row.can_share)buttons.push([control('share'),control('unshare')]);
  // Возврат к списку — явная кнопка вместо тупика; data без номера,
  // иначе номер превратил бы команду в поисковый запрос.
  buttons.push([btn(messageButton(store, lang, 'bot.controls', 'requests'), '/requests')]);
  return { text, buttons };
}
