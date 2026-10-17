// Ошибка возврата после Telegram OIDC (AUTH-01, ADR-001). GoTrue возвращает
// браузер на адрес кабинета с параметрами error/error_description: в
// имплицитном потоке — в фрагменте URL (#error=...), при редирект-ошибках —
// в строке запроса (?error=...). supabase-js такую ошибку не показывает и
// URL не чистит, а Refine при отбое на /login теряет фрагмент. Поэтому
// параметры читаются и стираются при загрузке модуля — до маршрутизации, —
// а страница входа сообщает об ошибке возврата без текста от сервера.

export interface AuthCallbackError {
  /** Код ошибки от Auth-сервера, например access_denied или server_error. */
  error: string;
  /** Человекочитаемое описание; null, если сервер его не передал. */
  description: string | null;
}

/** Была ли страница загружена с PKCE-кодом в строке запроса (?code=...).
 *
 * Фиксируется при загрузке модуля, до того как supabase-js сотрёт код из
 * URL после успешного обмена (при провале обмена код остаётся в URL).
 * Не стираем параметр сами: обмен кода выполняет supabase-js.
 */
let pkceCodeAtLoad = false;
if (typeof window !== "undefined") {
  pkceCodeAtLoad = new URLSearchParams(window.location.search).has("code");
}

/** Страница загрузилась с возвратом PKCE-кода; null — нет. */
export function hadPkceCodeAtLoad(): boolean {
  return pkceCodeAtLoad;
}

/** Читает параметры ошибки возврата из строки запроса и фрагмента URL. */
export function readCallbackErrorFromLocation(): AuthCallbackError | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const error = query.get("error") ?? fragment.get("error");
  if (error === null) return null;
  return {
    error,
    description: query.get("error_description") ?? fragment.get("error_description"),
  };
}

function clearCallbackParamsFromLocation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.searchParams.delete("error_code");
  if (url.hash !== "") {
    url.hash = "";
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

const callbackError: AuthCallbackError | null = readCallbackErrorFromLocation();
if (callbackError !== null) {
  clearCallbackParamsFromLocation();
}

/** Ошибка возврата OAuth текущей загрузки страницы; null, если её не было. */
export function getAuthCallbackError(): AuthCallbackError | null {
  return callbackError;
}
