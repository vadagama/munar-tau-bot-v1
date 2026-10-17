import { requestStateText } from "../locales/requests.ts";
import type { Row } from "../domains/registry/validation.ts";
import { requestActions } from "./help.ts";
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
import { cmd, esc, numbered, pick, type Lang } from "./text.ts";

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
    `<b>${esc(r.number ?? pick(lang, "Черновик", "Жоба"))}</b> — ${
      esc(requestStateText(r.state, lang))
    }${
      r.can_manage !== true && r.author_person_id !== personId
        ? pick(lang, " (совместное)", " (ортақ)")
        : ""
    }\n${esc(preview(r.description, 120))}`
  );
  const body = list.length ? numbered(list) : pick(lang, "Обращений нет", "Өтініш жоқ");
  // Подсказка пагинации остаётся текстом: в эмуляции кнопок не видно.
  const pagination = rows.length > 10
    ? `\n${esc(`/requests page:${page + 1}`)} — ${pick(lang, "далее", "әрі қарай")}`
    : "";
  const hasDraft = visible.some((r) => r.state === "draft");
  const hint = hasDraft
    ? pick(
      lang,
      `${cmd("/sendrequest")} — отправить черновик; ${cmd("/newrequest")} — новое`,
      `${cmd("/sendrequest")} — жобаны жіберу; ${cmd("/newrequest")} — жаңа`,
    )
    : pick(
      lang,
      `${cmd("/request НОМЕР")} — открыть обращение; ${cmd("/newrequest")} — новое`,
      `${cmd("/request НОМІР")} — өтінішті ашу; ${cmd("/newrequest")} — жаңа`,
    );
  const text = preview(`${body}${pagination}\n${hint}`, 4000);
  const buttons: InlineButton[][] = rows.length > 10
    ? [[btn(pick(lang, "Далее", "Әрі қарай"), `/requests page:${page + 1}`)]]
    : [];
  return buttons.length ? { text, buttons } : text;
}

export function requestCardText(row: Row, lang: Lang = "ru"): BotReply {
  const messages = (row.messages as Row[]).filter((m) =>
    m.channel === "resident"
  ).slice(-3);
  const result = (row.confirmation as Row | undefined)?.payload as
    | Row
    | undefined;
  const reports = (result?.task_results as Row[]) ?? [];
  const text = preview(
    [
      `<b>${esc(row.number)}</b> — ${esc(requestStateText(row.state, lang))}`,
      esc(preview(row.description, 600)),
      messages.map((m) => esc(preview(m.text, 400))).join("\n"),
      result ? esc(preview(result.summary, 600)) : "",
      reports.length
        ? `${pick(lang, "Отчётов", "Есептер")}: ${reports.length}. ${
          esc(`/result ${row.number} НОМЕР_ОТЧЁТА`)
        }`
        : "",
      `${pick(lang, "Версия результата", "Нәтиже нұсқасы")}: ${row.confirmation_version}`,
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
