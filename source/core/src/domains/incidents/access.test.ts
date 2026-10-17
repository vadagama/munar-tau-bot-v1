import { expect, it } from "vitest";
import { can } from "../../pdp/evaluate.ts";
import { B1, B2, makeTestActor } from "../../testing/actors.ts";
const access = { buildingIds: [B1], isTest: false, responsibleId: "duty", member: false, published: false };
it("дежурный управляет только назначенным ему инцидентом в своей области", () => {
  const duty = makeTestActor("duty", [B1], { personId: "duty" });
  expect(can(duty, "incident.manage", { incidentAccess: access }).allow).toBe(true);
  expect(can(duty, "incident.manage", { incidentAccess: { ...access, responsibleId: "other" } }).allow).toBe(false);
  expect(can(duty, "incident.manage", { incidentAccess: { ...access, buildingIds: [B2] } }).allow).toBe(false);
  expect(can(duty, "incident.link", { incidentAccess: access }).allow).toBe(false);
});
it("администратор не расширяет охват за пределы своих домов", () => {
  const admin = makeTestActor("administrator", [B1]);
  expect(can(admin, "incident.manage", { incidentAccess: access }).allow).toBe(true);
  expect(can(admin, "incident.manage", { incidentAccess: { ...access, buildingIds: [B1, B2] } }).allow).toBe(false);
  expect(can(admin, "incident.manage", { incidentAccess: { ...access, isTest: true } }).allow).toBe(false);
});
it("техническая роль не даёт права управлять аварией", () => {
  expect(can(makeTestActor("tech_admin", []), "incident.manage", { incidentAccess: access }).allow).toBe(false);
});
it("жителю видна только опубликованная карточка его аудитории", () => {
  const resident = makeTestActor("executor", [B1]); resident.assignments = [];
  expect(can(resident, "incident.read", { incidentAccess: { ...access, member: true, published: true } }).allow).toBe(true);
  expect(can(resident, "incident.read", { incidentAccess: { ...access, member: true } }).allow).toBe(false);
  expect(can(resident, "incident.manage", { incidentAccess: { ...access, member: true, published: true } }).allow).toBe(false);
});
