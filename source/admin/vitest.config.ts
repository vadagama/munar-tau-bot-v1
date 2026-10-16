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
  },
});
