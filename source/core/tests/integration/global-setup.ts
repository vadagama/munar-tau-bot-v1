// Глобальная подготовка интеграционного прогона (vitest.integration.config.ts):
// применяет миграции к TEST_DATABASE_URL — они идемпотентны, поэтому шаг
// безопасен и для уже подготовленной БД. По завершении прогона оставляет БД
// в состоянии сида (identity_dev.sql) — общая dev-БД не остаётся пустой.
// Без TEST_DATABASE_URL подготовка пропускается (сами тесты skipIf).

import { applyMigrations, applyRlsShield, createTestDb, resetTestData, testDatabaseUrl } from "./helpers.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (testDatabaseUrl() === null) {
    console.log(
      "[integration] TEST_DATABASE_URL не задан — интеграционные тесты будут пропущены (шаблон: tools/scripts/env.example.txt)",
    );
    return async () => {};
  }

  const db = createTestDb();
  try {
    const applied = await applyMigrations(db);
    console.log(`[integration] Миграции применены (операторов выполнено: ${applied})`);
    await applyRlsShield(db);
    console.log("[integration] RLS-заслон применён (rls.sql)");
  } finally {
    await db.close();
  }

  return async () => {
    const teardown = createTestDb();
    try {
      await resetTestData(teardown);
    } finally {
      await teardown.close();
    }
  };
}
