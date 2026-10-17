// Сквозная проверка Edge API + PostgreSQL, только очищаемая Sydney-БД.
// Из source/: deno run --allow-env --allow-read --allow-net --config deno.json tools/scripts/check-vs3-api.ts
import { type ApiDeps, handleWithDeps } from "../../functions/api/index.ts";
import { createDbClient } from "../../core/src/db/client.ts";
import { SqlAdminRepo } from "../../core/src/domains/admin/repo.ts";
import { SqlAuditRepo } from "../../core/src/domains/audit/repo.ts";
import { SqlEmulationRepo } from "../../core/src/domains/emulation/repo.ts";
import { ScenarioRegistry } from "../../core/src/bot/registry.ts";
import { createTestJwtKeyPair } from "../../core/src/testing/sign-jwt.ts";
import { buildJwtKeys } from "../../core/src/auth/jwt.ts";
import { consumeRateLimit } from "../../core/src/domains/requests/rate-limit.ts";
import {
  acquireTestDatabaseLock,
  applyMigrations,
  applyRlsShield,
  resetTestData,
  SEED,
  testDatabaseUrl,
} from "../../core/tests/integration/helpers.ts";
const uri = testDatabaseUrl();
if (!uri) throw new Error("Нужен TEST_DATABASE_URL тестового проекта Sydney");
const lock = createDbClient(uri, { max: 1, maxLifetime: 0 });
const db = createDbClient(uri);
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
let acquired = false;
try {
  console.log("[vs3-api] Ожидание эксклюзивного доступа к Sydney");
  await acquireTestDatabaseLock(lock);
  acquired = true;
  await applyMigrations(db);
  await applyRlsShield(db);
  await resetTestData(db);
  const premises = crypto.randomUUID();
  await db.query(
    "insert into premises(id,building_id,kind,number,is_test) values ($1,$2,'apartment','API-smoke',true)",
    [premises, SEED.building1],
  );
  await db.query(
    "insert into connection(person_id,premises_id,role,basis,status) values ($1,$2,'tenant','rent','active')",
    [SEED.testExecutorPersonId, premises],
  );
  await db.query(
    "with a as (insert into staff_assignment(person_id,role) values ($1,'administrator') returning id) insert into staff_scope(assignment_id,building_id) select id,$2 from a",
    [SEED.testAdminPersonId, SEED.building1],
  );
  const signer = await createTestJwtKeyPair("vs3-api-test");
  const token = async (person: string) => {
    const sub = crypto.randomUUID();
    await db.query(
      "update profile set supabase_user_id=$2 where person_id=$1",
      [person, sub],
    );
    return signer.sign({
      sub,
      session_id: crypto.randomUUID(),
      aud: "authenticated",
      role: "authenticated",
      iat: Math.floor(Date.now() / 1000) - 5,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  };
  const resident = await token(SEED.testExecutorPersonId),
    admin = await token(SEED.testAdminPersonId);
  const deps: ApiDeps = {
    db,
    admin: new SqlAdminRepo(),
    audit: new SqlAuditRepo(),
    emulation: new SqlEmulationRepo(),
    scenarios: new ScenarioRegistry(),
    jwtKeys: await buildJwtKeys(signer.jwksJson()),
    cabinetOrigin: undefined,
    rateLimit: (id) => consumeRateLimit(db, id),
  };
  const call = async (
    jwt: string,
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
    key?: string,
    expected = 200,
  ) => {
    const response = await handleWithDeps(
      new Request(`https://api.example.invalid/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      deps,
    );
    const data = await response.json();
    assert(
      response.status === expected,
      `${method} ${path}: ${response.status} (${
        data.error?.code ?? "unexpected"
      })`,
    );
    assert(
      response.headers.get("cache-control") === "no-store",
      "Нет защиты кэша",
    );
    return data;
  };
  const context = await call(resident, "/requests/context");
  assert(context.premises.length === 1, "Не найдено своё помещение");
  const body = {
    kind: "question",
    premises_id: premises,
    text: "Вопрос для сквозной проверки API",
    source: "web",
  };
  let row = await call(resident, "/requests", "POST", body, "api-create", 201);
  const retry = await call(
    resident,
    "/requests",
    "POST",
    body,
    "api-create",
    201,
  );
  assert(retry.id === row.id, "Повтор создал дубль");
  const search = await call(resident, "/requests/search", "POST", {
    search: "сквозной",
  });
  assert(search.items.length === 1, "Поиск не нашёл обращение");
  row = await call(admin, `/requests/${row.id}/transitions`, "POST", {
    action: "start_review",
    expected_version: row.version,
  });
  row = await call(admin, `/requests/${row.id}/transitions`, "POST", {
    action: "ask_clarification",
    expected_version: row.version,
    reason: "Нужно место",
    payload: { question: "У какой двери?" },
  });
  await call(
    resident,
    `/requests/${row.id}/messages`,
    "POST",
    { text: "У входной двери", channel: "resident" },
    "api-answer",
    201,
  );
  row = await call(resident, `/requests/${row.id}`);
  assert(row.state === "reviewing", "Сообщение не сняло ожидание уточнения");
  assert(
    row.messages.filter((m: { text: string }) => m.text === "У входной двери")
      .length === 1,
    "Ответ продублирован",
  );
  await call(
    resident,
    `/requests/${row.id}/messages?channel=internal`,
    "GET",
    undefined,
    undefined,
    403,
  );
  row = await call(admin, `/requests/${row.id}/transitions`, "POST", {
    action: "submit_result",
    expected_version: row.version,
    payload: { confirmation_payload: { summary: "Итоговый ответ жителю" } },
  });
  row = await call(resident, `/requests/${row.id}/transitions`, "POST", {
    action: "confirm_result",
    expected_version: row.version,
    payload: { confirmation_version: row.confirmation_version },
  });
  assert(
    row.state === "closed" && row.close_method === "author",
    "Нет подтверждённого закрытия",
  );
  await call(resident, `/requests/${row.id}/rating`, "POST", {
    value: 5,
    comment: "Проверено",
  });
  assert(
    (await db.query("select id from notification where channel='telegram'"))
      .length === 0,
    "Тестовое уведомление вышло наружу",
  );
  console.log(
    "[vs3-api] OK: JWT → профиль → сеанс → PDP → создание/повтор → POST-поиск → уточнение сообщением → результат → подтверждение → оценка; internal=403; уведомления только simulator",
  );
} finally {
  try {
    if (acquired) await resetTestData(db);
  } finally {
    await db.close();
    await lock.close();
  }
}
