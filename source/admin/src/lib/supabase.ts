// Клиент Supabase Auth (ADR-001): сессии хранит supabase-js, проверка профиля
// и полномочий — на сервере (PDP, функция api). Клиент создаётся один раз.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { appEnv } from "./env";

let client: SupabaseClient | null = null;

/** Клиент или null, если публичные переменные среды не заданы. */
export function getSupabase(): SupabaseClient | null {
  if (!appEnv.configured) return null;
  if (client === null) {
    client = createClient(appEnv.supabaseUrl!, appEnv.supabaseKey!, {
      auth: {
        // Явно закреплённый PKCE-поток: возврат идёт с ?code=... и обмен
        // выполняет supabase-js. Дефолт библиотеки — устаревший implicit
        // (#access_token=... в фрагменте), а ADR-001 и инструкция настройки
        // предполагают PKCE.
        flowType: "pkce",
      },
    });
  }
  return client;
}
