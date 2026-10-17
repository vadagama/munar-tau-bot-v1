import { expect, it } from "vitest";
import { canonical } from "./service.ts";
import { verifyFileHeader } from "./files.ts";
it("каноническое тело различает самостоятельные операции и сохраняет вложенные массивы", () => {
  const value = { b: 2, a: [{ z: 3, c: 4 }] };
  expect(JSON.parse(canonical(value))).toEqual(value);
  expect(canonical(value)).not.toBe(canonical({ ...value, b: 3 }));
});
it("заголовок файла должен соответствовать заявленному расширению", () => {
  expect(() =>
    verifyFileHeader("тест.pdf", new TextEncoder().encode("%PDF-1.7"))
  ).not.toThrow();
  expect(() =>
    verifyFileHeader("тест.pdf", new TextEncoder().encode("MZ executable"))
  ).toThrow();
  expect(() =>
    verifyFileHeader("тест.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  ).not.toThrow();
});
