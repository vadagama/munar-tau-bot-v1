import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { mutateRegistry } from "../../src/domains/registry/service.ts";
import type { Actor } from "../../src/pdp/types.ts";
const chairman: Actor = {
  person: {
    id: SEED.chairmanPersonId,
    fullName: "Председатель",
    status: "active",
    isTest: false,
  },
  profile: {
    id: "33333333-3333-3333-3333-333333333301",
    personId: SEED.chairmanPersonId,
    language: "ru",
    isTest: false,
  },
  assignments: [
    {
      id: "x",
      role: "chairman",
      financialRights: false,
      registryExportRights: false,
      regulationsRights: false,
      scopeBuildingIds: undefined,
    },
  ],
  emulation: null,
};
describeWithDb("VS-2 реестр", (getDb) => {
  it("сохраняет, меняет и очищает очередь здания без потери при PATCH других полей", async () => {
    const [profile] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1", [SEED.chairmanPersonId],
    );
    const actor = { ...chairman, profile: { ...chairman.profile, id: profile!.id } };
    const deps = { db: getDb(), audit: new SqlAuditRepo() };
    const building = await mutateRegistry(deps, actor, "buildings", { code: "ОЧ-1", construction_phase: 1 });
    expect(building.construction_phase).toBe(1);
    const updated = await mutateRegistry(deps, actor, "buildings", { name: "Дом" }, String(building.id));
    expect(updated.construction_phase).toBe(1);
    const changed = await mutateRegistry(deps, actor, "buildings", { construction_phase: 5 }, String(building.id));
    expect(changed.construction_phase).toBe(5);
    const cleared = await mutateRegistry(deps, actor, "buildings", { construction_phase: null }, String(building.id));
    expect(cleared.construction_phase).toBeNull();
    await expect(getDb().query("update building set construction_phase=6 where id=$1", [building.id])).rejects.toThrow();
  });
  it("поддерживает четыре типа помещений в доме, блокирует дубль внутри типа", async () => {
    const [profile] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1",
      [SEED.chairmanPersonId],
    );
    chairman.profile.id = profile!.id;
    const deps = { db: getDb(), audit: new SqlAuditRepo() };
    const row = { building_id: SEED.building1, number: "1", kind: "apartment" };
    await mutateRegistry(deps, chairman, "premises", row);
    await mutateRegistry(deps, chairman, "premises", {
      ...row,
      kind: "storage",
    });
    await mutateRegistry(deps,chairman,"premises",{...row,kind:"commercial"});
    await mutateRegistry(deps,chairman,"premises",{
      ...row,
      kind: "parking_slot",
    });
    await expect(
      mutateRegistry(deps, chairman, "premises", row),
    ).rejects.toThrow();
    expect(await getDb().query("select * from premises")).toHaveLength(4);
  });
  it("сохраняет нескольких собственников и ID при смене телефона", async () => {
    const [profile] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1",
      [SEED.chairmanPersonId],
    );
    chairman.profile.id = profile!.id;
    const deps = { db: getDb(), audit: new SqlAuditRepo() };
    const p = await mutateRegistry(deps, chairman, "premises", {
      building_id: SEED.building1,
      number: "1",
      kind: "apartment",
    });
    const ids: string[] = [];
    for (const [name, phone] of [
      ["Первый", "+77010000011"],
      ["Второй", "+77010000012"],
    ]) {
      const person = await mutateRegistry(deps, chairman, "persons", {
        full_name: name,
        phone_e164: phone,
        premises_id: p.id,
        source: "test",
        processing_basis: "registry",
      });
      ids.push(String(person.id));
      const [connection] = await getDb().query<{ id: string }>(
        "select id from connection where person_id=$1",
        [person.id],
      );
      await mutateRegistry(
        deps,
        chairman,
        "connections",
        { status: "active" },
        connection!.id,
      );
    }
    const [original] = await getDb().query<{
      id: string;
      confirmed_by: string;
    }>("select id,confirmed_by from connection where person_id=$1", [ids[0]]);
    const [otherProfile] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1",
      [SEED.techAdminPersonId],
    );
    const other = {
      ...chairman,
      person: { ...chairman.person, id: SEED.techAdminPersonId },
      profile: {
        ...chairman.profile,
        id: otherProfile!.id,
        personId: SEED.techAdminPersonId,
      },
    };
    await mutateRegistry(
      deps,
      other,
      "connections",
      { basis: "ownership", start_date: "2026-10-01" },
      original!.id,
    );
    expect(
      (
        await getDb().query<{ confirmed_by: string }>(
          "select confirmed_by from connection where id=$1",
          [original!.id],
        )
      )[0]?.confirmed_by,
    ).toBe(original!.confirmed_by);
    const updated = await mutateRegistry(
      deps,
      chairman,
      "persons",
      { phone_e164: "87010000013" },
      ids[0],
    );
    expect(updated.id).toBe(ids[0]);
    expect(updated.phone_e164).toBe("+77010000013");
    expect(
      await getDb().query("select * from connection where status='active'"),
    ).toHaveLength(2);
  });
});
