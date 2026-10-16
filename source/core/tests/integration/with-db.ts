// describe-обёртка над чистой БД. Отдельный файл, чтобы global-setup.ts
// не импортировал API vitest (globalSetup выполняется вне тестового контекста).

import { afterAll, beforeAll, beforeEach, describe } from "vitest";

import type { DbClient } from "../../src/db/client.ts";
import { createTestDb, resetTestData, testDatabaseUrl } from "./helpers.ts";

/**
 * describe-блок с чистой БД: пропускается без TEST_DATABASE_URL, перед каждым
 * тестом truncate + сид, соединение закрывается после прогона файла.
 */
export function describeWithDb(name: string, body: (getDb: () => DbClient) => void): void {
  describe.skipIf(testDatabaseUrl() === null)(name, () => {
    let db: DbClient | undefined;

    beforeAll(() => {
      db = createTestDb();
    });
    beforeEach(async () => {
      if (db) await resetTestData(db);
    });
    afterAll(async () => {
      if (db) await db.close();
    });

    body(() => {
      if (!db) throw new Error("БД не подключена — beforeAll не выполнился");
      return db;
    });
  });
}
