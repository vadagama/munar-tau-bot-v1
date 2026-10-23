import { expect, it } from "vitest";
import { can } from "../../pdp/evaluate.ts";
import type { Actor, ResourceRef, StaffRole } from "../../pdp/types.ts";
function actor(role?: StaffRole): Actor {
  return { person: { id: "p", fullName: "Тест", isTest: true, status: "active" },
    profile: { id: "profile", personId: "p", language: "ru", isTest: true }, emulation: null,
    assignments: role ? [{ id: "a", role, scopeBuildingIds: ["b1"], financialRights: false, registryExportRights: false, regulationsRights: false }] : [] };
}
it("FIN: финансовый архив доступен собственнику области и финансовому сотруднику", () => {
  const r: ResourceRef = { publicationAccess: { buildingIds: ["b1"], isTest: true, published: true, member: true, financial: true, owner: false } };
  for (const role of [undefined, "executor", "doc_reviewer", "tech_admin"] as const) expect(can(actor(role), "publication.read", r).allow).toBe(false);
  expect(can(actor("finance"), "publication.read", r).allow).toBe(true);
  expect(can(actor(), "publication.read", { publicationAccess: { ...r.publicationAccess!, owner: true } }).allow).toBe(true);
  expect(can(actor(), "publication.read", { publicationAccess: { ...r.publicationAccess!, owner: true, published: false } }).allow).toBe(false);
  expect(can(actor("finance"), "publication.read", { publicationAccess: { ...r.publicationAccess!, buildingIds: ["b2"] } }).allow).toBe(false);
  expect(can(actor("chairman"), "publication.read", { publicationAccess: { ...r.publicationAccess!, isTest: false } }).allow).toBe(false);
});
