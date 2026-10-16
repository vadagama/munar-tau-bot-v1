import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Статика кабинета: сборка в dist/ и раздача с Cloudflare Pages (ADR-002),
// SPA-fallback на index.html выполняет платформа. Без серверных функций.
export default defineConfig({
  plugins: [react()],
});
