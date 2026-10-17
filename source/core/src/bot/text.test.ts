import { describe, expect, it } from "vitest";

import {
  cmd,
  esc,
  fmtDate,
  fmtInterval,
  isUuid,
  langOf,
  numbered,
  pick,
  resolveRef,
} from "./text.ts";

describe("esc", () => {
  it("экранирует спецсимволы HTML", () => {
    expect(esc("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
    expect(esc(null)).toBe("");
    expect(esc("обычный текст")).toBe("обычный текст");
  });
});

describe("fmtDate", () => {
  it("показывает дату в поясе Алматы (UTC+5) без ICU", () => {
    expect(fmtDate("2026-10-17T09:30:00Z")).toBe("17.10.2026 14:30");
    expect(fmtDate("2026-12-31T20:00:00Z")).toBe("01.01.2027 01:00");
    expect(fmtDate(new Date("2026-01-01T00:30:00Z"))).toBe("01.01.2026 05:30");
  });
  it("пустые и некорректные значения не дают Invalid Date", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("")).toBe("—");
    expect(fmtDate("не дата")).toBe("не дата");
  });
  it("интервал склеивает два значения", () => {
    expect(fmtInterval("2026-10-17T09:30:00Z", "2026-10-17T11:00:00Z")).toBe(
      "17.10.2026 14:30 – 17.10.2026 16:00",
    );
  });
});

describe("resolveRef", () => {
  const objects = ["aaaa1111-0000-4000-8000-000000000001"];
  const pending = ["bbbb2222-0000-4000-8000-000000000002"];
  it("номер строки резолвит по объединению списков", () => {
    expect(resolveRef("2", [objects, pending])).toBe(pending[0]);
    expect(resolveRef("1", [objects, pending])).toBe(objects[0]);
  });
  it("вне диапазона и без списков — null", () => {
    expect(resolveRef("3", [objects])).toBeNull();
    expect(resolveRef("1", [])).toBeNull();
    expect(resolveRef(undefined, [objects])).toBeNull();
    expect(resolveRef("", [objects])).toBeNull();
  });
  it("полный UUID проходит как есть", () => {
    expect(resolveRef("CCCC3333-0000-4000-8000-000000000003", [])).toBe(
      "CCCC3333-0000-4000-8000-000000000003",
    );
  });
  it("уникальный префикс находит id, неоднозначный — null", () => {
    const group = ["ddd00001-0000-4000-8000-000000000001", "ddd00002-0000-4000-8000-000000000002"];
    expect(resolveRef("ddd00001", [group])).toBe(group[0]);
    expect(resolveRef("ddd", [group])).toBeNull();
    expect(resolveRef("fffffff", [group])).toBeNull();
  });
  it("мусор не превращается в ссылку", () => {
    expect(resolveRef("abc", [objects])).toBeNull();
    expect(resolveRef("дом 1", [objects])).toBeNull();
  });
});

describe("прочее", () => {
  it("isUuid", () => {
    expect(isUuid("aaaa1111-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("aaaa1111")).toBe(false);
  });
  it("numbered нумерует строки", () => {
    expect(numbered(["a", "b"])).toBe("1. a\n2. b");
    expect(numbered([])).toBe("");
  });
  it("cmd оборачивает команду в code с экранированием", () => {
    expect(cmd("/say <номер>")).toBe("<code>/say &lt;номер&gt;</code>");
  });
});

describe("язык подачи (срез UX B)", () => {
  it("langOf: kk — казахский, остальное и отсутствие — русский", () => {
    expect(langOf("kk")).toBe("kk");
    expect(langOf("ru")).toBe("ru");
    expect(langOf("fr")).toBe("ru");
    expect(langOf(undefined)).toBe("ru");
    expect(langOf(null)).toBe("ru");
  });
  it("pick выбирает реплику по языку", () => {
    expect(pick("ru", "да", "иә")).toBe("да");
    expect(pick("kk", "да", "иә")).toBe("иә");
  });
});
