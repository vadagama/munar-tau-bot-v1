// authProvider Refine (Task 6, план VS-1): вход — Telegram OIDC, проверка
// сеанса — getSession supabase-js, профиль и полномочия проверяет функция api
// (PDP) при каждом запросе. 401 от API обрабатывается в api.ts (выход на
// /login); здесь — реакции Refine на ошибки хуков.

import type { AuthProvider } from "@refinedev/core";

import { ApiClientError, apiFetch } from "./api";
import { appEnv } from "./env";
import { getSupabase } from "./supabase";
import { signInWithTelegram } from "./telegram-auth";
import type { MeResponse } from "./types";

export const authProvider: AuthProvider = {
  /** Вход: браузер уходит на Supabase Auth → Telegram и возвращается. */
  async login() {
    const supabase = getSupabase();
    if (supabase === null) {
      return {
        success: false,
        error: new Error(
          "Вход не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY",
        ),
      };
    }
    const result = await signInWithTelegram(supabase);
    if (!result.ok) {
      return { success: false, error: new Error(result.error ?? "Не удалось начать вход") };
    }
    // Редирект выполняет signInWithOAuth; сюда приходим при ошибке запуска.
    return { success: true };
  },

  async check() {
    const supabase = getSupabase();
    if (supabase === null) {
      return { authenticated: false, redirectTo: "/login" };
    }
    const { data } = await supabase.auth.getSession();
    // Профиль/полномочия проверяет API (PDP); 401 от apiFetch уводит на /login.
    return { authenticated: data.session !== null, redirectTo: "/login" };
  },

  async onError(error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return { logout: true, redirectTo: "/login" };
    }
    return {};
  },

  /** Выход: отзыв собственного сеанса (AUTH-06, план VS-1) + signOut. */
  async logout() {
    try {
      const me = await apiFetch<MeResponse>("/v1/meta/me");
      await apiFetch(`/v1/admin/sessions/${me.session.id}/revoke`, {
        method: "POST",
        body: { reason: "Выход из кабинета" },
      });
    } catch {
      // Сеанс мог истечь или API недоступен — всё равно завершаем вход.
    }
    await getSupabase()?.auth.signOut();
    return { success: true, redirectTo: "/login" };
  },

  /** Идентичность для шапки и баннера эмуляции — из /v1/meta/me. */
  async getIdentity() {
    const me = await apiFetch<MeResponse>("/v1/meta/me");
    return {
      id: me.person.id,
      fullName: me.person.full_name,
      me,
    };
  },
};

/** Роли действующих назначений идентичности — для меню и страниц. */
export function rolesOf(me: MeResponse): string[] {
  return [...new Set(me.assignments.map((assignment) => assignment.role))];
}

/** Кабинет доступен без настроенной среды? (нет — заглушка VS-0) */
export function isAuthConfigured(): boolean {
  return appEnv.configured;
}
