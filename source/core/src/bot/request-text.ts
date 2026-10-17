import { requestStateText } from "../locales/requests.ts";
import type { Row } from "../domains/registry/validation.ts";
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
  help: string,
): string {
  const list = rows.slice(0, 10).map((r) =>
    `${r.number ?? "Черновик / Жоба"}: ${requestStateText(r.state)}${
      r.can_manage !== true && r.author_person_id !== personId
        ? " (совместное / ортақ)"
        : ""
    }\n${preview(r.description, 120)}`
  ).join("\n\n");
  return preview(
    `${list || "Обращений нет / Өтініш жоқ"}\n${
      rows.length > 10 ? `/requests page:${page + 1} — далее / келесі\n` : ""
    }${help}`,
    4000,
  );
}
export function requestCardText(row: Row, help: string): string {
  const messages = (row.messages as Row[]).filter((m) =>
    m.channel === "resident"
  ).slice(-3);
  const result=(row.confirmation as Row|undefined)?.payload as Row|undefined;
  const reports=(result?.task_results as Row[])??[];
  return preview(
    `${row.number}: ${requestStateText(row.state)}\n${
      preview(row.description, 600)
    }\n${
      messages.map((m) => preview(m.text, 400)).join("\n")
    }\n${result?preview(result.summary,600):""}${reports.length?`\nОтчётов: ${reports.length}. /result ${row.number} НОМЕР_ОТЧЁТА`:""}\nВерсия результата / Нәтиже нұсқасы: ${row.confirmation_version}\n${help}`,
    4000,
  );
}
