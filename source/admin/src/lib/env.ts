// Публичные переменные среды кабинета (ADR-002): только publishable-значения,
// допустимые в браузере и статической сборке. Без env кабинет работает в
// режиме заглушки (VS-0) — вход заблокирован, сообщение о настройке.

interface AppEnv {
  /** Адрес Supabase (проекта или self-hosted инстанса). */
  readonly supabaseUrl: string | null;
  /** Publishable key Supabase (не секрет — см. AGENTS.md, границы). */
  readonly supabaseKey: string | null;
  /** Базовый адрес функции api: {supabaseUrl}/functions/v1/api. */
  readonly apiUrl: string | null;
  /** Среда настроена — вход доступен. */
  readonly configured: boolean;
  /** Регион функций рядом с БД; null — автоматический выбор / self-hosted. */
  readonly functionRegion: string | null;
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const supabaseUrl = rawUrl?.trim() ? rawUrl.trim().replace(/\/$/, "") : null;
const supabaseKey = rawKey?.trim() ? rawKey.trim() : null;

export const appEnv: AppEnv = {
  supabaseUrl,
  supabaseKey,
  apiUrl: supabaseUrl !== null ? `${supabaseUrl}/functions/v1/api` : null,
  functionRegion: (import.meta.env.VITE_SUPABASE_FUNCTION_REGION as string | undefined)?.trim() || null,
  configured: supabaseUrl !== null && supabaseKey !== null,
};
