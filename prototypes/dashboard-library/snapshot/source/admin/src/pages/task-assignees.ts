const ROLE_LABELS: Record<string, string> = {
  chairman: "Председатель", administrator: "Администратор", deputy: "Заместитель",
  executor: "Исполнитель", tech_admin: "Технический администратор", duty: "Дежурный",
  finance: "Финансы", doc_reviewer: "Проверяющий документов",
};

/** Порядок сервера сохраняется: сначала сотрудники области, затем остальные. */
export function taskAssigneeOptions(people: Record<string, unknown>[]) {
  return people.map(person => {
    const roles = Array.isArray(person.roles)
      ? person.roles.map(role => ROLE_LABELS[String(role)] ?? String(role)).join(", ")
      : "";
    return {
      value: String(person.id),
      label: `${String(person.full_name)}${roles ? ` — ${roles}` : ""}`,
    };
  });
}
