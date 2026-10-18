export const VERSION_CONFLICT_MESSAGE =
  "Карточка изменена другим пользователем. Данные обновлены, ваш ввод сохранён. Проверьте изменения перед повторным подтверждением.";

export function isVersionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}
