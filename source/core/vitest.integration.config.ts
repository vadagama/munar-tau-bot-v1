import { defineConfig } from "vitest/config";

// Интеграционные тесты против dev-БД Supabase (TEST_DATABASE_URL, HLD §19:
// транзакционность, идемпотентность, поведение на реальном PostgreSQL).
// БД общая и очищается между тестами — файлы выполняются строго последовательно.
export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
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
