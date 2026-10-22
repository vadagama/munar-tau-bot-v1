// Проверка поиска инициатора на синтетических CTE в read-only транзакции.
// Из source/: deno run --config deno.json --env-file=.env.migration --allow-env --allow-net tools/scripts/check-request-initiator.ts NEW_DATABASE_URL
import { createDbClient } from "../../core/src/db/client.ts";
import { listRequests } from "../../core/src/domains/requests/service.ts";
import type { RegistryDeps } from "../../core/src/domains/registry/service.ts";
import type { Actor } from "../../core/src/pdp/types.ts";
const actorId = "10000000-0000-0000-0000-000000000001",
  authorId = "10000000-0000-0000-0000-000000000002",
  building = "20000000-0000-0000-0000-000000000001";
const actor: Actor = {
  profile: { id: "p", personId: actorId, isTest: true, language: "ru" },
  person: {
    id: actorId,
    fullName: "Сотрудник",
    status: "active",
    isTest: true,
  },
  assignments: [{
    id: "a",
    role: "administrator",
    scopeBuildingIds: [building],
    financialRights: false,
    registryExportRights: false,
    regulationsRights: false,
  }],
  emulation: null,
};
let query = "", params: readonly unknown[] = [];
const unexpected = () =>
  Promise.reject(new Error("Unexpected operation during SQL capture"));
const deps: RegistryDeps = {
  db: {
    query: <T>(sql: string, values?: readonly unknown[]): Promise<T[]> => {
      query = sql;
      params = values ?? [];
      return Promise.resolve([]);
    },
    transaction: unexpected,
    close: unexpected,
  },
  audit: { append: unexpected, list: unexpected },
};
await listRequests(deps, actor, { search: "соколова" });
const prefix = `with request as (
 select 'r1'::text id,'З-1'::text number,'Описание'::text description,true is_test,'${authorId}'::uuid author_person_id,'new'::text state,null::uuid complaint_subject_person_id,'administrator'::text complaint_route,'${building}'::uuid building_id,null::uuid premises_id,now() created_at
 union all select 'r2','З-2','Вне области',true,'${authorId}','new',null,'administrator','20000000-0000-0000-0000-000000000002',null,now()
 union all select 'r3','З-3','Председателю',true,'${authorId}','new',null,'chairman','${building}',null,now()
 union all select 'r4','З-4','Черновик',true,'${authorId}','draft',null,'administrator','${building}',null,now()
 union all select 'r5','З-5','Реальные данные',false,'${authorId}','new',null,'administrator','${building}',null,now()
), person as (select '${authorId}'::uuid id,'Анна Соколова'::text full_name,true is_test),
message as (select null::text request_id,null::text channel,null::timestamptz restricted_at,null::text text where false),
request_participant as (select null::uuid person_id,null::text request_id,null::text role,null::timestamptz revoked_at where false),
connection as (select null::uuid person_id,null::uuid premises_id,null::text status where false) `;
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
    const rows = await exec.query<{ id: string; author_name: string }>(
      prefix + query,
      params,
    );
    if (
      rows.length !== 1 || rows[0]?.id !== "r1" ||
      rows[0]?.author_name !== "Анна Соколова"
    ) throw new Error("Ошибка поиска или области доступа");
    const notFound = [...params];
    notFound[5] = "Несуществующий инициатор";
    if ((await exec.query(prefix + query, notFound)).length !== 0) {
      throw new Error("Поиск не ограничивает выдачу");
    }
    console.log(
      JSON.stringify({
        readOnly: true,
        initiatorSearch: true,
        authorName: true,
        scopeAndComplaintsProtected: true,
        draftsAndRealDataExcluded: true,
      }),
    );
  });
} finally {
  await db.close();
}
