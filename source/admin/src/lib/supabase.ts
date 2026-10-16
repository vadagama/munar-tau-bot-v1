// Клиент Supabase Auth (ADR-001): сессии хранит supabase-js, проверка профиля
// и полномочий — на сервере (PDP, функция api). Клиент создаётся один раз.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { appEnv } from "./env";

let client: SupabaseClient | null = null;

/** Клиент или null, если публичные переменные среды не заданы. */
export function getSupabase(): SupabaseClient | null {
  if (!appEnv.configured) return null;
  if (client === null) {
    client = createClient(appEnv.supabaseUrl!, appEnv.supabaseKey!);
  }
  return client;
}
