import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Тесты воркспейса идут в Node: модуль `cloudflare:workers` существует только
// в рантайме Workers, поэтому в тестах он подменяется шимом (см. src/testing).
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: fileURLToPath(new URL("./src/testing/cloudflare-workers-shim.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
