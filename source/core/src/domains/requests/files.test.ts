import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, validateFile } from "./files.ts";
import { canonical } from "./service.ts";
describe("VS-3 FIL-01 и REQ-05", () => {
  it.each([["тест.jpg", "image/jpeg"], ["Видео.mov", "video/quicktime"], [
    "акт.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ], ["архив.7z", "application/x-7z-compressed"]])(
    "разрешает %s",
    (name, mime) =>
      expect(validateFile(name, MAX_FILE_BYTES, mime).size).toBe(
        MAX_FILE_BYTES,
      ),
  );
  it("отклоняет превышение, исполняемый файл и несовпадение MIME", () => {
    expect(() =>
      validateFile("file.pdf", MAX_FILE_BYTES + 1, "application/pdf")
    ).toThrow();
    expect(() => validateFile("file.exe", 100, "application/octet-stream"))
      .toThrow();
    expect(() => validateFile("file.jpg", 100, "text/html")).toThrow();
    expect(() => validateFile("../file.pdf", 100, "application/pdf")).toThrow();
  });
  it("порядок полей JSON не меняет ключ операции", () =>
    expect(canonical({ a: 1, b: [{ x: 2, y: 3 }] })).toBe(
      canonical({ b: [{ y: 3, x: 2 }], a: 1 }),
    ));
});

import { SupabaseFileStorage } from "./files.ts";
import { vi } from "vitest";
it("Storage REST info: нормализует content_type из ответа сервера", async () => {
  vi.stubGlobal(
    "fetch",
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ size: 4, content_type: "application/pdf" }),
          { status: 200 },
        ),
      ),
  );
  try {
    const storage = new SupabaseFileStorage(
      "https://example.invalid",
      "test-only-key",
    );
    expect(await storage.info("resident", "test")).toEqual({
      size: 4,
      mime: "application/pdf",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
