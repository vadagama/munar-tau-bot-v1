import { content } from "../requests/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { DOCUMENT_KINDS } from "../documents/types.ts";
type DocumentKind = typeof DOCUMENT_KINDS[number];

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) invalid("Выберите запись из списка");
  return value.toLowerCase();
}
function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid("Укажите действительную дату периода");
  return value;
}
function code(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,49}$/.test(value)) invalid("Код содержит латинские буквы, цифры и подчёркивание");
  if (value === "report") invalid("Код report зарезервирован для основного отчёта");
  return value;
}
function unique<T>(values: T[]): T[] {
  if (new Set(values).size !== values.length) invalid("В комплекте есть повторяющиеся записи");
  return values;
}
export interface FinancialAgreement { code: string; label: string; kind: DocumentKind; signed_required: boolean }
export interface FinancialRule {
  name: string; form: "monthly" | "annual"; form_description: string;
  building_ids: string[];
  prepared_by: string; reviewer_id: string; publisher_id: string;
  required_agreements: FinancialAgreement[]; channels: string[]; report_signed_required: boolean;
}
export function financialRuleInput(input: Row): FinancialRule {
  if (!["monthly", "annual"].includes(String(input.form))) invalid("Выберите месячный или годовой отчёт");
  if (!Array.isArray(input.required_agreements) || !input.required_agreements.length || input.required_agreements.length > 20) invalid("Укажите необходимые внешние основания (до 20)");
  const agreements = input.required_agreements.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Некорректное согласование");
    const item = value as Row, kind = DOCUMENT_KINDS.find(k => k === item.kind);
    if (!kind || typeof item.signed_required !== "boolean") invalid("Укажите тип основания и необходимость подписанного экземпляра");
    return { code: code(item.code), label: content(item.label), kind, signed_required: item.signed_required };
  });
  unique(agreements.map(a => a.code));
  if (!Array.isArray(input.channels) || !input.channels.length || input.channels.length > 20 || typeof input.report_signed_required !== "boolean") invalid("Укажите обязательные каналы размещения и признак подписи отчёта");
  const prepared = uuid(input.prepared_by), reviewer = uuid(input.reviewer_id);
  if (!Array.isArray(input.building_ids) || !input.building_ids.length || input.building_ids.length > 1000) invalid("Укажите дома регламента");
  if (prepared === reviewer) invalid("Подготовитель и проверяющий должны отличаться");
  return { name: content(input.name), form: input.form as FinancialRule["form"], form_description: content(input.form_description),
    building_ids: unique(input.building_ids.map(uuid)).sort(),
    prepared_by: prepared, reviewer_id: reviewer, publisher_id: uuid(input.publisher_id),
    required_agreements: agreements, channels: unique(input.channels.map(value => content(value))).sort(), report_signed_required: input.report_signed_required };
}
export interface FinancialInput {
  obligation_id: string; period_from: string; period_to: string; report_version_id: string;
  basis_versions: { code: string; document_version_id: string }[]; disclosed_version_ids: string[]; correction_note: string;
}
export function financialPeriodInput(input: Row) {
  const from = day(input.period_from), to = day(input.period_to);
  if (to < from) invalid("Конец периода предшествует началу");
  return { period_from: from, period_to: to };
}
export function financialInput(input: Row): FinancialInput {
  const { period_from: from, period_to: to } = financialPeriodInput(input), report = uuid(input.report_version_id);
  if (!Array.isArray(input.basis_versions) || !input.basis_versions.length || input.basis_versions.length > 30 || !Array.isArray(input.disclosed_version_ids)) invalid("Укажите основания и раскрываемый комплект");
  const bases = input.basis_versions.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Некорректное основание");
    const item = value as Row;
    return { code: code(item.code), document_version_id: uuid(item.document_version_id) };
  });
  unique(bases.map(b => b.code)); unique([report, ...bases.map(b => b.document_version_id)]);
  const disclosed = unique(input.disclosed_version_ids.map(uuid));
  if (!disclosed.includes(report) || disclosed.some(id => id !== report && !bases.some(b => b.document_version_id === id))) invalid("Раскрываемый комплект должен включать отчёт и только выбранные основания");
  return { obligation_id: uuid(input.obligation_id), period_from: from, period_to: to, report_version_id: report,
    basis_versions: bases.sort((a, b) => a.code.localeCompare(b.code)), disclosed_version_ids: disclosed.sort(), correction_note: input.correction_note == null || (typeof input.correction_note === "string" && !input.correction_note.trim()) ? "" : content(input.correction_note) };
}
export interface FinancialDocument {
  id: string; document_id: string; kind: string; state: string; is_test: boolean; audience: string;
  prepared_by: string; reviewer_id: string;
  building_ids: string[]; signed_attachment_id: string | null;
}
/** Вход documents получен сервером из конкретных версий под блокировкой. */
export function checkedFinancialPackage(input: FinancialInput, documents: FinancialDocument[], context: { buildingIds: string[]; isTest: boolean; rule: FinancialRule; periodFrom: string; periodTo: string }) {
  if (input.period_from !== context.periodFrom || input.period_to !== context.periodTo) invalid("Период отчёта должен соответствовать документальной обязанности");
  if (JSON.stringify([...context.buildingIds].sort()) !== JSON.stringify(context.rule.building_ids)) invalid("Охват отчёта должен соответствовать зафиксированному регламенту");
  const report = documents.find(d => d.id === input.report_version_id);
  if (!report || report.kind !== "financial_report" || report.audience !== "owner" || report.prepared_by !== context.rule.prepared_by || report.reviewer_id !== context.rule.reviewer_id || (context.rule.report_signed_required && !report.signed_attachment_id)) invalid("Нужна проверенная версия финансового отчёта для собственников с требуемой подписью и назначенными сотрудниками");
  const ids = [input.report_version_id, ...input.basis_versions.map(b => b.document_version_id)].sort();
  if (documents.length !== ids.length || ids.some(id => !documents.some(d => d.id === id))) invalid("Не найден полный комплект версий документов");
  for (const document of documents) {
    if (document.state !== "approved" || document.is_test !== context.isTest ||
      (document.building_ids.length && context.buildingIds.some(id => !document.building_ids.includes(id)))) invalid("Основание не проверено или не охватывает все дома отчёта");
    if (input.disclosed_version_ids.includes(document.id) && !["owner", "resident"].includes(document.audience)) invalid("Служебное основание нельзя раскрыть собственникам");
  }
  for (const agreement of context.rule.required_agreements) {
    const selected = input.basis_versions.find(b => b.code === agreement.code), document = documents.find(d => d.id === selected?.document_version_id);
    if (!document || document.kind !== agreement.kind || (agreement.signed_required && !document.signed_attachment_id)) invalid(`Не готово основание: ${agreement.label}`);
  }
  return { ...input, documents: [...documents].sort((a, b) => a.id.localeCompare(b.id)) };
}
