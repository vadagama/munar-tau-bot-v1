import { Button, Checkbox, Form, Input, Select, Typography } from "antd";
type Person = { id: unknown; full_name?: unknown };
const required = [{ required: true, message: "Заполните поле" }];
export function DocumentRuleFields({ people }: { people: Person[] }) {
  const options = people.map(p => ({ value: p.id, label: String(p.full_name) }));
  return <Form.List name="document_requirements">{(fields, { add, remove }) => <>
    <Typography.Title level={5}>Документальные требования</Typography.Title>
    <Typography.Paragraph type="secondary">Требования создаются вместе с заданием по этой версии методички. Срок задаёт регламент ОСИ. Сотрудника без управленческих прав назначьте исполнителем задания при запуске.</Typography.Paragraph>
    {fields.map(field => <div key={field.key}>
      <Form.Item name={[field.name, "kind"]} label="Тип документа" rules={required}><Select options={Object.entries({ act: "Акт", work_report: "Отчёт работы", invoice: "Счёт", receipt: "Квитанция", decision_basis: "Основание решения", instruction: "Инструкция", financial_report: "Финансовый отчёт", other: "Другой документ" }).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name={[field.name, "phase"]} label="Этап предоставления" rules={required}><Select options={[{ value: "before_acceptance", label: "До приёмки" }, { value: "after_acceptance", label: "После приёмки" }]} /></Form.Item>
      <Form.Item name={[field.name, "basis"]} label="Основание обязательности" rules={required}><Input.TextArea maxLength={10000} /></Form.Item>
      <Form.Item name={[field.name, "prepared_by"]} label="Подготовитель документа" rules={required}><Select showSearch optionFilterProp="label" options={options} /></Form.Item>
      <Form.Item name={[field.name, "reviewer_id"]} label="Проверяющий документа" rules={required}><Select showSearch optionFilterProp="label" options={options} /></Form.Item>
      <Form.Item name={[field.name, "signed_required"]} valuePropName="checked"><Checkbox>Требуется отдельный подписанный экземпляр</Checkbox></Form.Item>
      <Button onClick={() => remove(field.name)}>Убрать документальное требование</Button>
    </div>)}
    <Button disabled={fields.length >= 20} onClick={() => add({ kind: "act", phase: "before_acceptance", signed_required: false })}>Добавить документальное требование</Button>
  </>}</Form.List>;
}
