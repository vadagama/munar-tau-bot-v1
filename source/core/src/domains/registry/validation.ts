import { ApiError } from "../../errors/api.ts";

export const PREMISES_KINDS = [
  "apartment",
  "commercial",
  "parking_slot",
  "storage",
] as const;
export type PremisesKind = (typeof PREMISES_KINDS)[number];
export const CONNECTION_ROLES = [
  "owner",
  "tenant",
  "resident",
  "other",
] as const;
export type ConnectionRole = (typeof CONNECTION_ROLES)[number];
export const BASES = [
  "initial_registry",
  "ownership",
  "rent",
  "family",
  "other",
] as const;
export type Row = Record<string, unknown>;

export function invalid(message: string): never {
  throw new ApiError("VALIDATION_FAILED", message);
}

/** IMP-09: + и 8–15 цифр E.164; национальные 8/7 и 10 цифр — Казахстан. */
export function normalizePhone(value: unknown): string {
  if (typeof value !== "string" || !/^[+\d\s()\-]+$/.test(value))
    invalid("Укажите телефон E.164");
  let digits = value.replace(/[\s()\-]/g, "");
  if (/^8\d{10}$/.test(digits)) digits = `+7${digits.slice(1)}`;
  else if (/^7\d{10}$/.test(digits)) digits = `+${digits}`;
  else if (/^\d{10}$/.test(digits)) digits = `+7${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(digits))
    invalid("Телефон должен иметь формат E.164");
  return digits;
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim() || value.length > 300)
    invalid(`Заполните ${key}`);
  return value.trim();
}

export function validatePremises(row: Row): void {
  text(row, "building_id");
  text(row, "number");
  if (!PREMISES_KINDS.includes(row.kind as PremisesKind))
    invalid("Неизвестный тип помещения");
  for (const key of ["entrance", "floor"]) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      !Number.isSafeInteger(row[key])
    )
      invalid(`Некорректный ${key}`);
  }
}

export function validateConnectionRole(
  kind: string,
  role: unknown,
): asserts role is ConnectionRole {
  if (!CONNECTION_ROLES.includes(role as ConnectionRole))
    invalid("Неизвестная роль связи");
  if (kind !== "apartment" && role === "resident")
    invalid("Для нежилого объекта выберите арендатора или пользователя");
}

/** Session pooler может вернуть JSONB текстом (см. также audit/repo.ts). */
export function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export async function databaseValidation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "23505")
      throw new ApiError(
        "VALIDATION_FAILED",
        "Запись с таким телефоном, привязкой или ключом уже существует; автоматическое объединение запрещено",
      );
    if (
      code === "23503" ||
      code === "22P02" ||
      code === "23514" ||
      code === "22007" ||
      code === "22008"
    )
      throw new ApiError(
        "VALIDATION_FAILED",
        "Проверьте идентификаторы, формат и допустимость данных",
      );
    throw error;
  }
}
