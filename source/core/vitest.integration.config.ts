import { defineConfig } from "vitest/config";

// Интеграционные тесты против dev-БД Supabase (TEST_DATABASE_URL, HLD §19:
// транзакционность, идемпотентность, поведение на реальном PostgreSQL).
// БД общая и очищается между тестами — файлы выполняются строго последовательно.
// Временный режим разработки по решению пользователя 17.10.2026.
// Распространяется и на новые сценарии. Без opt-in не подключаемся к БД.
const enabled = process.env.RUN_INTEGRATION_TESTS === "1";
if (!enabled) {
  console.warn("[integration] Запуск временно отключён на время разработки. Только по явному запросу: RUN_INTEGRATION_TESTS=1 npm run test:integration");
}
export default defineConfig({
  test: {
    name: "integration",
    include: enabled ? ["tests/integration/**/*.test.ts"] : [],
    passWithNoTests: !enabled,
    globalSetup: enabled ? ["tests/integration/global-setup.ts"] : [],
    // Удалённая dev-БД через session pooler: RTT большой, канал флапает —
    // таймауты заделаны с запасом, чтобы не ложно краснить стабильные тесты;
    // retry: 1 переживает разовый сетевой флап (перед каждым тестом БД
    // пересоздаётся truncate + сид, повтор безопасен).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 1,
    fileParallelism: false,
  },
});
