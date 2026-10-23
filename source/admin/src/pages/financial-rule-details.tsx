import { List, Typography } from "antd";
type Row = Record<string, unknown>;
export const financialDocumentKinds: Record<string, string> = { act: "Акт", work_report: "Отчёт работы", invoice: "Счёт", receipt: "Квитанция", decision_basis: "Основание решения", instruction: "Инструкция", financial_report: "Финансовый отчёт", other: "Другой документ" };
export function FinancialRuleDetails({ rule, buildings = [] }: { rule: Row; buildings?: Row[] }) {
  const definition = rule.definition as Row;
  const ids = (definition.building_ids as string[]) ?? [];
  return <>
    <Typography.Paragraph>{definition.form === "annual" ? "Годовой" : "Месячный"} отчёт: {String(definition.name ?? rule.name ?? "")}. {rule.active === false ? "Регламент отключён." : "Регламент действует."}</Typography.Paragraph>
    <Typography.Paragraph>{String(definition.form_description ?? "")}</Typography.Paragraph>
    <Typography.Paragraph>{buildings.length ? `Дома: ${ids.map(id => String(buildings.find(b => b.id === id)?.code ?? "Дом вне справочника")).join(", ")}.` : `Количество домов: ${ids.length}.`}</Typography.Paragraph>
    <Typography.Paragraph>Подготовитель: {String(rule.prepared_name ?? "—")}. Проверяющий: {String(rule.reviewer_name ?? "—")}. Публикатор: {String(rule.publisher_name ?? "—")}.</Typography.Paragraph>
    <Typography.Paragraph>Подписанный отчёт: {definition.report_signed_required ? "обязателен" : "не обязателен"}. Обязательные каналы: {((definition.channels as string[]) ?? []).join(", ")}.</Typography.Paragraph>
    <List size="small" header="Внешние основания" dataSource={(definition.required_agreements as Row[]) ?? []} renderItem={item => <List.Item>{String(item.label)} · {financialDocumentKinds[String(item.kind)] ?? "Документ"} · {item.signed_required ? "подпись обязательна" : "подпись не обязательна"}</List.Item>} />
  </>;
}
