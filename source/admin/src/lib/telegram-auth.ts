// Telegram OIDC — изолированный вызов (ADR-001, план VS-1: риск R3 — точная
// форма custom-провайдера проверяется при настройке среды self-hosted Auth).
// Только этот модуль знает, как вызывается вход через Telegram.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function signInWithTelegram(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "custom:telegram",
    options: {
      // Возврат в кабинет после аутентификации (Cloudflare Pages, ADR-002).
      redirectTo: window.location.origin,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  // Браузер уходит на Supabase Auth → Telegram; сюда возвращается после входа.
  return { ok: true };
}
