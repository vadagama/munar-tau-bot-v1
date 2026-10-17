import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Статика кабинета: сборка в dist/ и раздача с Cloudflare Pages (ADR-002),
// SPA-fallback на index.html выполняет платформа. Без серверных функций.
//
// Локальная интеграция с облачным бэкендом: задайте ADMIN_UPSTREAM_URL = адрес
// Supabase-проекта (в admin/.env.local или в окружении) и VITE_SUPABASE_URL =
// http://localhost:5173 — тогда dev-сервер проксирует /auth/v1 и /functions/v1
// на прод: браузер ходит на свой origin, и CORS не возникает (функция api
// знает только origin кабинета из секрета CABINET_ORIGIN). strictPort не даёт
// Vite уйти на соседний порт и разорвать пару с VITE_SUPABASE_URL.
export default defineConfig(({ mode }) => {
  const configured = loadEnv(mode, process.cwd(), "ADMIN_").ADMIN_UPSTREAM_URL
    ?? process.env.ADMIN_UPSTREAM_URL;
  const upstream = configured?.trim().replace(/\/$/, "");
  const proxy = upstream
    ? {
        "/auth/v1": { target: upstream, changeOrigin: true },
        "/functions/v1": { target: upstream, changeOrigin: true },
      }
    : undefined;
  return {
    plugins: [react()],
    ...(proxy !== undefined ? { server: { strictPort: true, proxy }, preview: { proxy } } : {}),
  };
});
