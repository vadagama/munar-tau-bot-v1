import { expect, it } from "vitest";
import { encodeWorkbook, decodeWorkbook, SHEETS } from "./workbook.ts";
it("IMP-06: шаблон и выгрузка сохраняют четыре листа и постоянные ID", async () => {
  const payload = {
    buildings: [],
    premises: [],
    persons: [
      {
        key: "p1",
        id: "persistent",
        full_name: "Имя",
        phone_e164: "+77010000001",
      },
    ],
    connections: [],
  };
  const bytes = await encodeWorkbook(payload);
  const parsed = await decodeWorkbook(bytes);
  expect(parsed.persons[0]?.id).toBe("persistent");
  expect(Object.keys(SHEETS)).toHaveLength(4);
});
it("повреждённый файл отклоняется", async () => {
  await expect(decodeWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});
