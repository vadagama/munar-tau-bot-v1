import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Тесты кабинета: компоненты и утилиты в jsdom. Запускаются npm test
// вместе с ядром (npm run test --workspaces).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Тяжёлые тесты рендера страниц AntD на двухъядерных CI-раннерах идут
    // по 3–5+ секунд; дефолт Vitest 5000ms даёт случайные таймауты
    // (в time-rules.test.tsx для того же уже стоял локальный 15000).
    testTimeout: 15000,
  },
});
