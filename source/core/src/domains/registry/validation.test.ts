import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  validateConstructionPhase,
  validatePremises,
  validateConnectionRole,
} from "./validation.ts";

describe("реестр REG-11/12, IMP-09", () => {
  it("нормализует казахстанский телефон до проверки уникальности", () => {
    expect(normalizePhone("8 (701) 123-45-67")).toBe("+77011234567");
    expect(normalizePhone("+7 701 123 45 67")).toBe("+77011234567");
  });
  it("отклоняет отсутствие и некорректный телефон", () => {
    for (const phone of ["", "123", "+7000000000000000", "phone"]) {
      expect(() => normalizePhone(phone)).toThrow();
    }
  });
  it("принимает четыре типа с номером и родителем", () => {
    for (const kind of ["apartment", "commercial", "parking_slot", "storage"]) {
      expect(() =>
        validatePremises({ kind, number: "1А", building_id: "house" }),
      ).not.toThrow();
    }
    expect(() =>
      validatePremises({ kind: "storage", number: "", building_id: "house" }),
    ).toThrow();
  });
  it("ограничивает роль типом помещения", () => {
    expect(() => validateConnectionRole("storage", "resident")).toThrow();
    expect(() => validateConnectionRole("apartment", "resident")).not.toThrow();
    expect(() => validateConnectionRole("commercial", "other")).not.toThrow();
  });
});


describe("очередь строительства REG-11", () => {
  it.each([undefined, null, 1, 2, 3, 4, 5])("принимает %s", value => {
    expect(() => validateConstructionPhase(value)).not.toThrow();
  });
  it.each([0, 6, -1, 1.5, "1", "", true, {}, NaN, Infinity])("отклоняет %s", value => {
    expect(() => validateConstructionPhase(value)).toThrow("Очередь строительства");
  });
});
