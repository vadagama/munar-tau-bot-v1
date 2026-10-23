import { Form, Select } from "antd";
type Row = Record<string, unknown>;
export function FinancialStaffFields({ people, current }: { people: Row[]; current?: Row | null }) {
  return <>{([['prepared_by', 'Подготовитель', 'prepared_name'], ['reviewer_id', 'Проверяющий', 'reviewer_name'], ['publisher_id', 'Публикатор', 'publisher_name']] as const).map(([field, label, name]) => {
    const options: { value: unknown; label: string; disabled?: boolean }[] = people.filter(p => {
      const roles = (p.roles as string[]) ?? [];
      return roles.some(r => ["chairman", "administrator", "deputy"].includes(r)) || field === "reviewer_id" && roles.includes("finance") && roles.includes("doc_reviewer");
    }).map(p => ({ value: p.id, label: String(p.full_name) }));
    const id = current?.[field];
    if (id && !options.some(p => p.value === id)) options.push({ value: id, label: String(current?.[name] ?? "Прежний сотрудник — выберите действующего"), disabled: true });
    return <Form.Item key={field} name={field} label={label} rules={[{ required: true, message: "Выберите сотрудника" }]}><Select showSearch optionFilterProp="label" options={options} /></Form.Item>;
  })}</>;
}
