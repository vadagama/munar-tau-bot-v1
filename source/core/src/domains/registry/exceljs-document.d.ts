// Типы для закреплённых document-only модулей ExcelJS 4.4.0.
declare module "exceljs/lib/doc/workbook.js" {
  const Workbook: typeof import("exceljs").Workbook;
  export default Workbook;
}
declare module "exceljs/lib/doc/enums.js" {
  const enums: { ValueType: typeof import("exceljs").ValueType };
  export default enums;
}
