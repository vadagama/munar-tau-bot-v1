import { configDefaults, defineConfig } from "vitest/config";

// Модульные тесты ядра (src/**). Интеграционные тесты — отдельная конфигурация
// vitest.integration.config.ts: требуют TEST_DATABASE_URL и выполняются против
// dev-БД Supabase.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
});
