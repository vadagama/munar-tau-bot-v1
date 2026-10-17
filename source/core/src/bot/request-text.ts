import { requestStateText } from "../locales/requests.ts";
import type { Row } from "../domains/registry/validation.ts";
import { requestActions } from "./help.ts";
import { esc, numbered } from "./text.ts";

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
): string {
  const list = rows.slice(0, 10).map((r) =>
    `<b>${esc(r.number ?? "Черновик / Жоба")}</b> — ${esc(requestStateText(r.state))}${
      r.can_manage !== true && r.author_person_id !== personId
        ? " (совместное / ортақ)"
        : ""
    }\n${esc(preview(r.description, 120))}`
  );
  const body = list.length ? numbered(list) : "Обращений нет / Өтініш жоқ";
  const pagination = rows.length > 10
    ? `\n${esc(`/requests page:${page + 1}`)} — далее / келесі`
    : "";
  const hasDraft = rows.slice(0, 10).some((r) => r.state === "draft");
  const hint = hasDraft
    ? `${esc("/sendrequest")} — отправить черновик / жобаны жіберу; ${esc("/newrequest")} — новое / жаңа`
    : `${esc("/request НОМЕР")} — открыть обращение / өтінішті ашу; ${esc("/newrequest")} — новое / жаңа`;
  return preview(`${body}${pagination}\n${hint}`, 4000);
}

export function requestCardText(row: Row): string {
  const messages = (row.messages as Row[]).filter((m) =>
    m.channel === "resident"
  ).slice(-3);
  const result = (row.confirmation as Row | undefined)?.payload as
    | Row
    | undefined;
  const reports = (result?.task_results as Row[]) ?? [];
  const actions = requestActions(row.state);
  return preview(
    [
      `<b>${esc(row.number)}</b> — ${esc(requestStateText(row.state))}`,
      esc(preview(row.description, 600)),
      messages.map((m) => esc(preview(m.text, 400))).join("\n"),
      result ? esc(preview(result.summary, 600)) : "",
      reports.length
        ? `Отчётов: ${reports.length}. ${esc(`/result ${row.number} НОМЕР_ОТЧЁТА`)}`
        : "",
      `Версия результата / Нәтиже нұсқасы: ${row.confirmation_version}`,
      actions,
    ].filter(Boolean).join("\n"),
    4000,
  );
}
