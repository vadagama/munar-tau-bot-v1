import { expect, it } from "vitest";
import { EMPTY_REGISTRY_FILTERS, filterRegistryRows } from "./registry-filters";
import { summarizePhases } from "./registry-phases";
const kinds = [{ value: "apartment", label: "Квартира" }, { value: "storage", label: "Кладовка" }];
const roles = [{ value: "owner", label: "Собственник" }, { value: "tenant", label: "Арендатор" }];
const statuses = { active: "Действует", revoked: "Прекращена" };
const rows = [
  { id: "one", building_id: "b1", building_code: "107/1", full_name: "Иван Петров", phone_e164: "+77011112233", kind: "apartment", number: "12", construction_phase: 1, status: "active", role: "owner", entrance: "Б", floor: 3 },
  { id: "two", building_id: "b2", building_code: "108/2", full_name: "Анна Соколова", phone_e164: "+77014445566", kind: "storage", number: "8", construction_phase: null, status: "revoked", role: "tenant" },
];
it.each(["  иВАН  ", "107/1", "1112233", "Квартира", "Собственник", "Действует", "Б", "3"])(
  "поиск по ключевым полям и русским подписям: %s", search => {
    expect(filterRegistryRows(rows, { ...EMPTY_REGISTRY_FILTERS, search }, kinds, roles, statuses).map(row => row.id)).toEqual(["one"]);
  },
);
it("объединяет условия, учитывает отсутствие очереди и сброс", () => {
  expect(filterRegistryRows(rows, { search: "Петров", phase: 1, building: "b1", kind: "apartment", role: "owner", status: "active" }, kinds, roles, statuses)).toEqual([rows[0]]);
  expect(filterRegistryRows(rows, { search: "Петров", phase: "unassigned" }, kinds, roles, statuses)).toEqual([]);
  expect(filterRegistryRows(rows, { search: "", phase: "unassigned" }, kinds, roles, statuses)).toEqual([rows[1]]);
  expect(filterRegistryRows(rows, EMPTY_REGISTRY_FILTERS, kinds, roles, statuses)).toEqual(rows);
});
it("очереди учитывают только загруженные здания и их помещения, включая неуказанную очередь", () => {
  const summary = summarizePhases([
    { id: "b1", code: "107/1", name: "Первый дом", construction_phase: 1 },
    { id: "b2", code: "108/2", construction_phase: null },
  ], [{ id: "p1", building_id: "b1" }, { id: "p2", building_id: "b1" }, { id: "p3", building_id: "b2" }, { id: "hidden", building_id: "not-visible" }]);
  expect(summary.find(row => row.phase === 1)).toMatchObject({ building_count: 1, premises_count: 2, buildings: "Первый дом" });
  expect(summary.find(row => row.phase === null)).toMatchObject({ building_count: 1, premises_count: 1 });
  expect(summary.find(row => row.phase === 5)).toMatchObject({ building_count: 0, premises_count: 0 });
});
