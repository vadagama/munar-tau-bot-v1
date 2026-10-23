import { invalid } from "../registry/validation.ts";
export function validatePublicationRelease(
  value: {
    kind: string;
    requires_document?: boolean;
    documentApproved?: boolean;
    approved_by?: unknown;
    workCompleted?: boolean;
  },
) {
  if (
    (value.requires_document || value.kind === "financial_report") &&
    !value.documentApproved
  ) {
    invalid(
      "Нужен проверенный комплект конкретных версий документов-оснований",
    );
  }
  if (value.kind === "financial_report" && !value.approved_by) {
    invalid("Нужно разрешение председателя после внешних согласований");
  }
  if (value.kind === "work_report" && !value.workCompleted) {
    invalid("Публикуется только принятый результат общей работы");
  }
}
