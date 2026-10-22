// Проверка запроса каталога на синтетических CTE в read-only транзакции. Данные БД не меняет.
// Из source/: deno run --config deno.json --env-file=.env.migration --allow-env --allow-net tools/scripts/check-resident-directory.ts NEW_DATABASE_URL
import { createDbClient } from "../../core/src/db/client.ts";
import {
  listRegistry,
  type RegistryDeps,
} from "../../core/src/domains/registry/service.ts";
import type { Actor } from "../../core/src/pdp/types.ts";
const b1 = "00000000-0000-0000-0000-000000000001",
  b2 = "00000000-0000-0000-0000-000000000002";
const prefix = `with person as (
 select '10000000-0000-0000-0000-000000000001'::uuid id,'Первый'::text full_name,true is_test
 union all select '10000000-0000-0000-0000-000000000002','Второй',true
), building as (select '${b1}'::uuid id,'А'::text code,'Адрес А'::text name union all select '${b2}','Б','Адрес Б'),
premises as (select '20000000-0000-0000-0000-000000000001'::uuid id,'${b1}'::uuid building_id,'apartment'::text kind,'1'::text number,true is_test
 union all select '20000000-0000-0000-0000-000000000002','${b2}','storage','2',true),
connection as (select '10000000-0000-0000-0000-000000000001'::uuid person_id,'20000000-0000-0000-0000-000000000001'::uuid premises_id,'active'::text status,'owner'::text role
 union all select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','active','owner'
 union all select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','revoked','tenant'),
registration as (
 select '30000000-0000-0000-0000-000000000001'::uuid id,'10000000-0000-0000-0000-000000000001'::uuid person_id,null::uuid premises_id,'pending_review'::text state,'2026-10-20Z'::timestamptz created_at,true is_test,null::uuid superseded_by
 union all select '30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','approved','2026-10-21Z',true,null
 union all select '30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',null,'withdrawn','2026-10-22Z',true,'30000000-0000-0000-0000-000000000001'
), staff_assignment as (select null::uuid person_id,null::text role,null::text status,null::timestamptz valid_from,null::timestamptz valid_until where false) `;
const actor: Actor = {
  profile: { id: "p", personId: "n", language: "ru", isTest: true },
  person: { id: "n", fullName: "Тест", status: "active", isTest: true },
  assignments: [{
    id: "a",
    role: "chairman",
    scopeBuildingIds: undefined,
    financialRights: false,
    registryExportRights: false,
    regulationsRights: false,
  }],
  emulation: null,
};
const variable = Deno.args[0] ?? "DATABASE_URL";
if (!["DATABASE_URL", "NEW_DATABASE_URL"].includes(variable)) {
  throw new Error("Unsupported connection variable");
}
const url = Deno.env.get(variable);
if (!url) throw new Error(`${variable} is required`);
const db = createDbClient(url, { max: 1, idleTimeout: 5 });
try {
  await db.transaction(async (exec) => {
    await exec.query("set transaction read only");
    const query = <T>(sql: string, params?: readonly unknown[]) =>
      exec.query<T>(prefix + sql, params);
    const deps = { db: { query } } as RegistryDeps;
    const all = (await listRegistry(deps, actor, "persons")).sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    if (
      all.length !== 2 || all[0]!.registration_state !== "pending_review" ||
      (all[0]!.linked_premises as unknown[]).length !== 2 ||
      (all[1]!.linked_premises as unknown[]).length !== 0 ||
      all[1]!.registration_state !== null
    ) throw Error("Ошибка общих данных");
    const scopedUnsorted = await listRegistry(deps, {
      ...actor,
      assignments: [{
        ...actor.assignments[0]!,
        role: "administrator",
        scopeBuildingIds: [b1],
      }],
    }, "persons");
    const scoped = scopedUnsorted.sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );
    if (
      scoped.length !== 2 ||
      (scoped[0]!.linked_premises as unknown[]).length !== 1 ||
      (scoped[1]!.linked_premises as unknown[]).length !== 0
    ) throw Error("Ошибка области");
    const real = await listRegistry(deps, {
      ...actor,
      person: { ...actor.person, isTest: false },
    }, "persons");
    if (real.length !== 0) throw Error("Смешаны тестовые и реальные данные");
    console.log(
      JSON.stringify({
        readOnly: true,
        primaryRegistration: true,
        supersededExcluded: true,
        activeConnectionsOnly: true,
        scopeRestricted: true,
        testDataIsolated: true,
      }),
    );
  });
} finally {
  await db.close();
}
