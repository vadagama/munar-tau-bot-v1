import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { SEED } from "./helpers.ts";
import { SqlAdminRepo } from "../../src/domains/admin/repo.ts";
import {
  buildActorForProfile,
  findProfileForAuth,
} from "../../src/domains/admin/actor-service.ts";
import { SqlAuditRepo } from "../../src/domains/audit/repo.ts";
import { mutateRegistry } from "../../src/domains/registry/service.ts";
import {
  submitRegistration,
  reviewRegistration,
  recoverTelegram,
} from "../../src/domains/registrations/service.ts";
import type { DbClient } from "../../src/db/client.ts";
async function setup(db: DbClient, personId = SEED.chairmanPersonId as string) {
  const repo = new SqlAdminRepo();
  const [p] = await db.query<{ id: string }>(
    "select id from profile where person_id=$1",
    [personId],
  );
  const actor = await buildActorForProfile(
    repo,
    db,
    (await repo.getProfile(db, p!.id))!,
    new Date(),
  );
  return { deps: { db, audit: new SqlAuditRepo() }, actor, repo };
}
describeWithDb("VS-2 безопасность", (getDb) => {
  it("REG-10: перенос сохраняет person, закрывает старую привязку, новый OIDC связывается только через auth.identities", async () => {
    const db = getDb();
    const { deps, actor, repo } = await setup(db);
    const p = await mutateRegistry(deps, actor, "premises", {
      building_id: SEED.building1,
      kind: "apartment",
      number: "91",
    });
    const draft = {
      full_name: "Тест восстановления",
      phone_e164: "+77010000091",
      language: "ru",
      consent: true,
      premises_id: p.id,
      role: "owner",
    };
    const first = await submitRegistration(deps, null, draft, "9900000091");
    const approved = await reviewRegistration(
      deps,
      actor,
      String(first.id),
      "approve",
      { reason: "Проверено по реестру" },
    );
    const [old] = await db.query<{ id: string }>(
      "select id from profile where person_id=$1 and archived_at is null",
      [approved.person_id],
    );
    const session = crypto.randomUUID();
    await db.query("insert into access_session(id,profile_id) values($1,$2)", [
      session,
      old!.id,
    ]);
    const second = await submitRegistration(deps, null, draft, "9900000092");
    await recoverTelegram(deps, actor, String(approved.person_id), {
      registration_id: second.id,
      verified_basis: "Личность проверена вне системы",
    });
    expect(
      (
        await db.query<{ revoked_at: unknown }>(
          "select revoked_at from access_session where id=$1",
          [session],
        )
      )[0]!.revoked_at,
    ).not.toBeNull();
    expect((await repo.getProfile(db, old!.id))!.archivedAt).not.toBeNull();
    expect(
      await db.query(
        "select * from connection where person_id=$1 and status='active'",
        [approved.person_id],
      ),
    ).toHaveLength(1);
    const authId = crypto.randomUUID(),
      identityId = crypto.randomUUID();
    const rollback = new Error("rollback test identity");
    await expect(
      db.transaction(async (exec) => {
        await exec.query(
          "insert into auth.users(id,aud,role) values ($1,'authenticated','authenticated')",
          [authId],
        );
        await expect(
          findProfileForAuth(repo, exec, authId),
        ).rejects.toMatchObject({ code: "NO_PROFILE" });
        await exec.query(
          "insert into auth.identities(id,user_id,provider,provider_id,identity_data) values ($1,$2,'custom:telegram','9900000092','{}'::jsonb)",
          [identityId, authId],
        );
        const linked = await findProfileForAuth(repo, exec, authId);
        expect(linked.personId).toBe(approved.person_id);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 180000);
  it("эмулируемый администратор не подаёт анкету настоящего человека даже на тестовый объект", async () => {
    const db = getDb();
    const { deps, actor } = await setup(db, SEED.testAdminPersonId);
    const [assignment] = await db.query<{ id: string }>(
      "insert into staff_assignment(person_id,role) values ($1,'administrator') returning id",
      [actor.person.id],
    );
    await db.query(
      "insert into staff_scope(assignment_id,building_id) values ($1,$2)",
      [assignment!.id, SEED.building1],
    );
    const [profile] = await db.query<{ id: string }>(
      "select id from profile where person_id=$1",
      [actor.person.id],
    );
    actor.assignments = (
      await buildActorForProfile(
        new SqlAdminRepo(),
        db,
        (await new SqlAdminRepo().getProfile(db, profile!.id))!,
        new Date(),
      )
    ).assignments;
    actor.emulation = {
      sessionId: "55555555-5555-5555-5555-555555555555",
      realPersonId: SEED.techAdminPersonId,
      realProfileId: actor.profile.id,
    };
    // Реальная запись emulation_session для аудита не нужна: отказ происходит до мутаций.
    const [premises] = await db.query<{ id: string }>(
      "insert into premises(building_id,kind,number,is_test) values ($1,'apartment','TEST-1',true) returning id",
      [SEED.building1],
    );
    await expect(
      submitRegistration(deps, actor, {
        person_id: SEED.chairmanPersonId,
        full_name: "Подмена",
        phone_e164: "+77010000001",
        language: "ru",
        consent: true,
        premises_id: premises!.id,
        role: "owner",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.query("select * from registration")).toHaveLength(0);
  });
});
