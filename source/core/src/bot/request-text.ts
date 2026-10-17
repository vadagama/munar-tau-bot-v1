import { requestStateText } from "../locales/requests.ts";
import type { Row } from "../domains/registry/validation.ts";
import { requestActions } from "./help.ts";
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
import { cmd, esc, fmtDate, fmtDay, numbered, pick, type Lang } from "./text.ts";

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
): BotReply {
  const visible = rows.slice(0, 10);
  const list = visible.map((r) =>
    `<b>${esc(r.number ?? pick(lang, "Черновик", "Жоба"))}</b>${
      r.state === "draft"
        ? ""
        : ` · ${esc(requestStateText(r.state, lang))} · ${esc(fmtDay(r.created_at))}`
    }${
      r.can_manage !== true && r.author_person_id !== personId
        ? ` · ${pick(lang, "совместное", "ортақ")}`
        : ""
    }\n${esc(preview(r.description, 120))}`
  );
  const text = preview(
    list.length ? numbered(list) : pick(lang, "Обращений нет", "Өтініш жоқ"),
    4000,
  );
  // Открытие — кнопкой в строке; у черновика — возобновление мастера отправки.
  const buttons: InlineButton[][] = visible.map((r) =>
    r.state === "draft"
      ? [btn(pick(lang, "Открыть", "Ашу"), "/newrequest")]
      : [btn(String(r.number), `/request ${r.number}`)]
  );
  if (rows.length > 10) {
    buttons.push([btn(pick(lang, "Далее", "Әрі қарай"), `/requests page:${page + 1}`)]);
  }
  return { text, buttons };
}

export function requestCardText(row: Row, lang: Lang = "ru"): BotReply {
  const messages = (row.messages as Row[]).filter((m) =>
    m.channel === "resident"
  ).slice(-3);
  const result = (row.confirmation as Row | undefined)?.payload as
    | Row
    | undefined;
  const reports = (result?.task_results as Row[]) ?? [];
  const authorLabel = (m: Row): string => {
    if (m.author_person_id === row.author_person_id) {
      return pick(lang, "Вы", "Сіз");
    }
    return m.author_kind === "staff"
      ? pick(lang, "Администратор", "Әкімші")
      : pick(lang, "Участник", "Қатысушы");
  };
  const text = preview(
    [
      `<b>${esc(row.number)}</b> · ${esc(requestStateText(row.state, lang))}`,
      `${
        esc(row.place_label ?? preview(row.location_text, 120) ??
          pick(lang, "Общая территория", "Ортақ аумақ"))
      } · ${pick(lang, "создано", "құрылды")} ${esc(fmtDate(row.created_at))}`,
      esc(preview(row.description, 600)),
      messages.length
        ? pick(lang, "Сообщения:", "Хабарламалар:") +
          "\n" +
          messages.map((m) =>
            `${esc(fmtDate(m.created_at))} — ${esc(authorLabel(m))}: ${
              esc(preview(m.text, 400))
            }`
          ).join("\n")
        : "",
      result ? esc(preview(result.summary, 600)) : "",
      reports.length
        ? `${pick(lang, "Отчёты", "Есептер")}: ${reports.length} — ${cmd(`/result ${row.number}`)}`
        : "",
      requestActions(row.state, lang),
    ].filter(Boolean).join("\n"),
    4000,
  );
  // Кнопки — точные текстовые команды: нажатие обрабатывается как ввод команды.
  const buttons: InlineButton[][] = [];
  if (row.state === "awaiting_confirmation" && row.number) {
    buttons.push([
      btn(
        pick(lang, "Принять результат", "Нәтижені қабылдау"),
        `/confirm ${row.number} ${row.confirmation_version}`,
      ),
    ]);
  }
  if (row.state === "closed" && row.number) {
    buttons.push(
      [1, 2, 3, 4, 5].map((value) => btn(`★ ${value}`, `/rate ${row.number} ${value}`)),
    );
  }
  return buttons.length ? { text, buttons } : text;
}
