import { expect, it } from "vitest";
import { assertFinancialSnapshot } from "./financial-store.ts";

it("разрешение относится к тому же комплекту, независимо от порядка ключей JSON", () => {
  const saved = { title: "Отчёт", documents: [{ id: "v1", state: "approved", attachment_id: "file1" }] };
  expect(() => assertFinancialSnapshot(saved, { documents: [{ state: "approved", attachment_id: "file1", id: "v1" }], title: "Отчёт" })).not.toThrow();
  for (const current of [
    { ...saved, title: "Другой отчёт" },
    { ...saved, documents: [{ id: "v1", state: "needs_fix", attachment_id: "file1" }] },
    { ...saved, documents: [{ id: "v2", state: "approved", attachment_id: "file2" }] },
  ]) expect(() => assertFinancialSnapshot(saved, current)).toThrow();
});
