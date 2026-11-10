import { expect, it } from "vitest";
import { staffFormFields } from "./staff-request-forms.ts";

it("отмена обязательного задания в боте не требует немедленной замены", () => {
  expect(staffFormFields("task_cancel", {}, { is_required: true }))
    .toEqual(["reason", "dependency_review"]);
  expect(staffFormFields("task_replace_canceled", {}, { is_required: true }))
    .toContain("replacement");
});
