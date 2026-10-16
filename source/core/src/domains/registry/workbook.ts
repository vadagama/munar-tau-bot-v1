// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- декларации общие для TypeScript Node и Deno.
/// <reference path="./exceljs-document.d.ts" />
import type ExcelTypes from "exceljs";
// Document-only entry исключает ненужные streaming/file-writer зависимости.
import Workbook from "exceljs/lib/doc/workbook.js";
import Enums from "exceljs/lib/doc/enums.js";
const ExcelJS={Workbook,ValueType:Enums.ValueType};
import { ApiError } from "../../errors/api.ts";
import type { Row } from "./validation.ts";
export const SHEETS = {
  buildings: {
    name: "Здания и паркинги",
    columns: ["key", "id", "kind", "code", "name", "house_keys"],
  },
  premises: {
    name: "Помещения",
    columns: [
      "key",
      "id",
      "building_key",
      "kind",
      "number",
      "entrance",
      "floor",
    ],
  },
  persons: { name: "Лица", columns: ["key", "id", "full_name", "phone_e164"] },
  connections: {
    name: "Связи",
    columns: ["key", "id", "person_key", "premises_key", "role", "basis"],
  },
} as const;
export type ImportPayload = Record<keyof typeof SHEETS, Row[]>;
export const emptyPayload = (): ImportPayload => ({
  buildings: [],
  premises: [],
  persons: [],
  connections: [],
});
function checkArchiveBudget(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new ApiError("VALIDATION_FAILED", "Некорректный XLSX ZIP");
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  if (count > 256 || offset + size > end)
    throw new ApiError("FILE_LIMIT", "Слишком сложный Excel");
  for (let entry = 0; entry < count; entry++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new ApiError("VALIDATION_FAILED", "Повреждённый XLSX ZIP");
    total += view.getUint32(offset + 24, true);
    if (total > 32 * 1024 * 1024)
      throw new ApiError(
        "FILE_LIMIT",
        "Распакованный Excel должен быть не более 32 МБ",
      );
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}
export async function decodeWorkbook(
  bytes: Uint8Array,
): Promise<ImportPayload> {
  if (bytes.length > 5 * 1024 * 1024)
    throw new ApiError("FILE_LIMIT", "Excel не более 5 МБ");
  checkArchiveBudget(bytes);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes as unknown as ExcelTypes.Buffer);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Не удалось прочитать .xlsx");
  }
  if (book.worksheets.length !== 4)
    throw new ApiError(
      "VALIDATION_FAILED",
      "Используйте шаблон из четырёх листов",
    );
  const result = emptyPayload();
  for (const key of Object.keys(SHEETS) as (keyof ImportPayload)[]) {
    const spec = SHEETS[key];
    const sheet = book.getWorksheet(spec.name);
    if (
      !sheet ||
      sheet.rowCount > 5001 ||
      sheet.columnCount > spec.columns.length
    )
      throw new ApiError(
        "VALIDATION_FAILED",
        `Лист ${spec.name}: неверная структура или более 5000 строк`,
      );
    for (const [i, col] of spec.columns.entries()) {
      if (sheet.getRow(1).getCell(i + 1).text !== col)
        throw new ApiError(
          "VALIDATION_FAILED",
          `${spec.name}: столбец ${i + 1} должен называться ${col}`,
        );
    }
    sheet.eachRow((row, index) => {
      if (index === 1 || !row.hasValues) return;
      const data: Row = { _row: index };
      for (const [i, col] of spec.columns.entries()) {
        const cell = row.getCell(i + 1);
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          cell.type === ExcelJS.ValueType.Hyperlink
        )
          throw new ApiError(
            "VALIDATION_FAILED",
            `${spec.name}, строка ${index}: формулы и ссылки запрещены`,
          );
        if (col === "entrance" || col === "floor")
          data[col] = cell.value === null ? null : Number(cell.text);
        else data[col] = cell.text.trim();
      }
      result[key].push(data);
    });
  }
  return result;
}
export async function encodeWorkbook(
  payload = emptyPayload(),
  issues: {
    sheet: string;
    row: number;
    field: string;
    reason: string;
    hint: string;
  }[] = [],
): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  for (const key of Object.keys(SHEETS) as (keyof ImportPayload)[]) {
    const spec = SHEETS[key];
    const sheet = book.addWorksheet(spec.name);
    sheet.columns = spec.columns.map((name) => ({
      header: name,
      key: name,
      width: 24,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF176B57" },
    };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of payload[key])
      sheet.addRow(
        Object.fromEntries(spec.columns.map((c) => [c, row[c] ?? ""])),
      );
    for (const column of ["kind", "role", "basis"]) {
      const index = spec.columns.findIndex((c) => c === column);
      if (index < 0) continue;
      const options =
        column === "role"
          ? "owner"
          : column === "basis"
            ? "initial_registry"
            : key === "buildings"
              ? "house,parking"
              : "apartment,commercial,parking_slot,storage";
      for (let row = 2; row <= 1000; row++)
        sheet.getRow(row).getCell(index + 1).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [`"${options}"`],
          showErrorMessage: true,
          error: "Выберите значение из списка",
        };
    }
    for (const issue of issues.filter((i) => i.sheet === spec.name)) {
      const column = spec.columns.findIndex((c) => c === issue.field) + 1;
      const cell = sheet.getRow(issue.row).getCell(Math.max(1, column));
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFCCCC" },
      };
      cell.note = `${issue.reason}\n${issue.hint}`;
    }
    sheet.getCell("A1").note =
      "Первичная загрузка: одна запись на ключ. key — уникальный ключ листа; ссылки *_key указывают на key другого листа. id оставьте пустым для новой записи. Только собственники-физлица; основание initial_registry. Телефон обязателен. Любая ошибка блокирует импорт. Данные существующих записей меняются в кабинете.";
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function fromBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > 7 * 1024 * 1024)
    throw new ApiError("FILE_LIMIT");
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Некорректный файл");
  }
}
