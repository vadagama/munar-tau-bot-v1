import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import { buildActorForProfile } from "../../src/domains/admin/actor-service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { mutateRegistry } from "../../src/domains/registry/service.ts";
import { emptyPayload } from "../../src/domains/registry/workbook.ts";
import {
  uploadImport,
  inspectImport,
  commitImport,
} from "../../src/domains/registry/import.ts";
import {
  createInvite,
  acceptInvite,
  reviewRegistration,
} from "../../src/domains/registrations/service.ts";
import { sweepRegistrations } from "../../src/domains/registrations/jobs.ts";
import { processInbound } from "../../src/bot/inbound.ts";
import type { DbClient } from "../../src/db/client.ts";
async function setup(db: DbClient) {
  const repo = new SqlAdminRepo();
  const [profile] = await db.query<{ id: string }>(
    "select id from profile where person_id=$1",
    [SEED.chairmanPersonId],
  );
  const actor = await buildActorForProfile(
    repo,
    db,
    (await repo.getProfile(db, profile!.id))!,
    new Date(),
  );
  return { deps: { db, audit: new SqlAuditRepo() }, actor };
}
describeWithDb("VS-2 сквозные REG/IMP", (getDb) => {
  it("IMP-02/03: ошибка блокирует всё, успешный commit сохраняет pending без профиля, повтор идемпотентен", async () => {
    const { deps, actor } = await setup(getDb());
    const payload = emptyPayload();
    payload.buildings = [
      { key: "b", id: SEED.building1, kind: "house", code: "1", name: "Дом 1" },
    ];
    const [b] = await getDb().query<{ code: string; name: string }>(
      "select code,name from building where id=$1",
      [SEED.building1],
    );
    payload.buildings[0]!.code = b!.code;
    payload.buildings[0]!.name = b!.name;
    payload.premises = [
      {
        key: "a",
        building_key: "b",
        kind: "apartment",
        number: "55",
        entrance: null,
        floor: null,
      },
    ];
    payload.persons = [
      { key: "n", full_name: "Тест импорта", phone_e164: "bad" },
    ];
    payload.connections = [
      {
        key: "c",
        person_key: "n",
        premises_key: "a",
        role: "owner",
        basis: "initial_registry",
      },
    ];
    const bad = await uploadImport(deps, actor, payload);
    expect((await inspectImport(deps, actor, String(bad.id))).state).toBe(
      "invalid",
    );
    await expect(commitImport(deps, actor, String(bad.id))).rejects.toThrow();
    expect(await getDb().query("select * from premises")).toHaveLength(0);
    payload.persons[0]!.phone_e164 = "87010000031";
    const good = await uploadImport(deps, actor, payload);
    const checked = await inspectImport(deps, actor, String(good.id));
    expect(checked.state, JSON.stringify(checked.errors)).toBe("ready");
    await commitImport(deps, actor, String(good.id));
    await commitImport(deps, actor, String(good.id));
    const [person] = await getDb().query<{ id: string }>(
      "select id from person where phone_e164='+77010000031'",
    );
    expect(
      await getDb().query("select * from profile where person_id=$1", [
        person!.id,
      ]),
    ).toHaveLength(0);
    expect(
      (
        await getDb().query<{ status: string }>(
          "select status from connection where person_id=$1",
          [person!.id],
        )
      )[0]?.status,
    ).toBe("pending");
    expect(
      await getDb().query("select * from import_mapping where batch_id=$1", [
        good.id,
      ]),
    ).toHaveLength(4);
  }, 180000);
  it("REG-03/05: приглашение одноразовое, спор не отзывает доступ, общий таймер не закрывает спор", async () => {
    const { deps, actor } = await setup(getDb());
    const premises = await mutateRegistry(deps, actor, "premises", {
      building_id: SEED.building1,
      kind: "apartment",
      number: "1",
    });
    await mutateRegistry(deps, actor, "connections", {
      person_id: actor.person.id,
      premises_id: premises.id,
      role: "owner",
      basis: "ownership",
      status: "active",
    });
    const invite = await createInvite(deps, actor, {
      premises_id: premises.id,
      role: "tenant",
    });
    const repo = new SqlAdminRepo();
    const [pr] = await getDb().query<{ id: string }>(
      "select id from profile where person_id=$1",
      [SEED.techAdminPersonId],
    );
    const tenant = await buildActorForProfile(
      repo,
      getDb(),
      (await repo.getProfile(getDb(), pr!.id))!,
      new Date(),
    );
    const accepted = await acceptInvite(deps, tenant, String(invite.token));
    await expect(
      acceptInvite(deps, tenant, String(invite.token)),
    ).rejects.toThrow();
    const reg = { id: accepted.registration_id };
    await reviewRegistration(
      deps,
      actor,
      String(reg.id),
      "dispute",
      { reason: "Возражение" },
      true,
    );
    expect(
      (
        await getDb().query<{ status: string }>(
          "select status from connection where person_id=$1 and premises_id=$2",
          [tenant.person.id, premises.id],
        )
      )[0]?.status,
    ).toBe("active");
    await sweepRegistrations(deps, new Date(Date.now() + 10 * 86400000));
    const [dispute] = await getDb().query<{
      state: string;
      overdue_at: unknown;
    }>("select state,overdue_at from registration where id=$1", [reg.id]);
    expect(dispute!.state).toBe("disputed");
    expect(dispute!.overdue_at).not.toBeNull();
  }, 180000);
  it("повтор webhook не создаёт повтор ответа или диалога", async () => {
    const { deps } = await setup(getDb());
    const update = {
      update_id: 12345,
      message: {
        from: { id: 12345 },
        chat: { id: 12345, type: "private" },
        text: "/register",
      },
    };
    expect(await processInbound(deps, update)).toBe(true);
    expect(await processInbound(deps, update)).toBe(false);
    expect(
      await getDb().query(
        "select * from notification where dedup_key='update:12345:reply'",
      ),
    ).toHaveLength(1);
    expect(
      await getDb().query(
        "select * from bot_dialog where telegram_user_id=12345",
      ),
    ).toHaveLength(1);
  });
});
