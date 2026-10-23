import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Select, Space, Spin, Typography, type FormInstance } from "antd";
import { apiFetch } from "../lib/api";
type Row = Record<string, unknown>;
export interface DocumentVersionOption { id: string; document_id: string; title: string; kind: string; audience: string; version: number; signed: boolean; label?: string; available?: boolean }
interface Agreement { code: string; label: string; kind: string; signed_required: boolean }
interface Duty extends Row { id: string; period_from: string; period_to: string; building_ids: string[]; rule_snapshot: { definition: { form_description: string; report_signed_required: boolean; required_agreements: Agreement[] } } }
const required = [{ required: true, message: "Выберите запись" }];
export function FinancialPackageFields({ form, obligations, versions, existing = [] }: { form: FormInstance; obligations: Row[]; versions: DocumentVersionOption[]; existing?: Row[] }) {
  const id = Form.useWatch("obligation_id", form), bases = Form.useWatch("basis_versions", form) as { code: string; document_version_id?: string }[] | undefined;
  const [duty, setDuty] = useState<Duty | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setDuty(null); setError(null);
    if (!id) return;
    setLoading(true);
    void apiFetch<Duty>(`/v1/financial-obligations/${id}`).then(next => {
      if (!live) return;
      const previous = (form.getFieldValue("basis_versions") ?? []) as { code: string; document_version_id?: string }[];
      const requiredCodes = new Set(next.rule_snapshot.definition.required_agreements.map(a => a.code));
      form.setFieldsValue({ period_from: next.period_from, period_to: next.period_to, building_ids: next.building_ids, requires_document: true,
        basis_versions: [...next.rule_snapshot.definition.required_agreements.map(agreement => ({ code: agreement.code, document_version_id: previous.find(p => p.code === agreement.code)?.document_version_id })), ...previous.filter(p => !requiredCodes.has(p.code))] });
      setDuty(next);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "Не удалось прочитать обязанность"); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, retry, form]);
  const basisIds = ((bases ?? form.getFieldValue("basis_versions") ?? []) as { document_version_id?: string }[]).map(b => b.document_version_id).filter(Boolean) as string[];
  const basisKey = JSON.stringify(basisIds);
  useEffect(() => {
    const selected = (form.getFieldValue("disclosed_version_ids") ?? []) as string[];
    const retained = selected.filter(value => (JSON.parse(basisKey) as string[]).includes(value));
    if (retained.length !== selected.length) form.setFieldValue("disclosed_version_ids", retained);
  }, [basisKey, form]);
  const catalog = [...versions];
  for (const part of existing) if (!catalog.some(v => v.id === part.document_version_id)) catalog.push({ id: String(part.document_version_id), document_id: String(part.document_id), title: String(part.title),
    kind: part.code === "report" ? "financial_report" : duty?.rule_snapshot.definition.required_agreements.find(a => a.code === part.code)?.kind ?? "other",
    audience: part.disclosed === true ? "owner" : "finance", version: 0, signed: !!part.signed_attachment_id, available: part.state === "approved", label: `${part.title} · сохранённая версия${part.state === "needs_fix" ? " · требует исправления" : ""}` });
  const disclosed = catalog.filter(v => basisIds.includes(v.id) && ["owner", "resident"].includes(v.audience));
  const options = (kind: string, signed: boolean) => catalog.filter(v => v.kind === kind).map(v => ({ value: v.id, label: v.label ?? `${v.title} · версия ${v.version}${v.signed ? " · подписан" : signed ? " · требуется подписанный экземпляр" : ""}`, disabled: v.available === false || (signed && !v.signed) }));
  return <>
    <Form.Item name="obligation_id" label="Обязанность по отчёту" rules={[...required, { validator: async () => { if (id && (loading || duty?.id !== id || error)) throw new Error("Дождитесь чтения выбранной обязанности"); } }]}>
      <Select showSearch optionFilterProp="label" onChange={() => form.setFieldsValue({ report_version_id: undefined, basis_versions: [], disclosed_version_ids: [] })}
        options={obligations.map(o => ({ value: String(o.id), label: `${o.period_from} — ${o.period_to}${o.prepared_name ? ` · ${o.prepared_name}` : ""}` }))} />
    </Form.Item>
    {loading && <Spin />}
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setRetry(n => n + 1)}>Повторить чтение обязанности</Button>} />}
    {duty && <>
      <Alert type="info" message={duty.rule_snapshot.definition.form_description} />
      <Space wrap><Form.Item name="period_from" label="Начало отчётного периода"><Input readOnly /></Form.Item><Form.Item name="period_to" label="Окончание отчётного периода"><Input readOnly /></Form.Item></Space>
      <Form.Item name="report_version_id" label="Проверенная версия финансового отчёта" rules={required}><Select showSearch optionFilterProp="label" options={options("financial_report", duty.rule_snapshot.definition.report_signed_required)} /></Form.Item>
      {duty.rule_snapshot.definition.required_agreements.map((agreement, i) => <div key={agreement.code}>
        <Form.Item name={["basis_versions", i, "code"]} hidden><Input /></Form.Item>
        <Form.Item name={["basis_versions", i, "document_version_id"]} label={`Основание: ${agreement.label}`} rules={required}><Select showSearch optionFilterProp="label" options={options(agreement.kind, agreement.signed_required)} /></Form.Item>
      </div>)}
      <Form.List name="basis_versions">{(fields, { add, remove }) => <>
        {fields.filter(field => field.name >= duty.rule_snapshot.definition.required_agreements.length).map((field, i) => <div key={field.key}>
          <Form.Item name={[field.name, "code"]} hidden><Input /></Form.Item>
          <Form.Item name={[field.name, "document_version_id"]} label={`Дополнительный документ ${i + 1}`} rules={required}><Select showSearch optionFilterProp="label" options={catalog.map(v => ({ value: v.id, label: v.label ?? `${v.title} · версия ${v.version}`, disabled: v.available === false }))} /></Form.Item>
          <Button danger onClick={() => remove(field.name)}>Удалить дополнительный документ {i + 1}</Button>
        </div>)}
        <Button disabled={fields.length >= 30} onClick={() => add({ code: `annex_${crypto.randomUUID().replaceAll("-", "")}` })}>Добавить дополнительный документ</Button>
      </>}</Form.List>
      <Typography.Paragraph>Основной отчёт раскрывается собственникам обязательно. Служебные основания остаются внутренними.</Typography.Paragraph>
      <Form.Item name="disclosed_version_ids" label="Дополнительно раскрыть собственникам"><Select mode="multiple" optionFilterProp="label" options={disclosed.map(v => ({ value: v.id, label: v.label ?? `${v.title} · версия ${v.version}` }))} /></Form.Item>
      {!versions.length && <Alert type="warning" message="Нет доступных проверенных версий. Подготовьте документы в разделе «Документы»." />}
    </>}
  </>;
}
