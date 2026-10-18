import { useEffect, useLayoutEffect, useRef } from "react";

export const PAGE_REFRESH_EVENT = "cabinet:refresh-page";

/** Обновляет данные без перемонтирования страницы и потери черновиков. */
export function usePageRefresh(
  refresh: () => unknown | Promise<unknown>,
  enabled: boolean | (() => boolean) = true,
) {
  const latest = useRef({ refresh, enabled });
  useLayoutEffect(() => { latest.current = { refresh, enabled }; });
  useEffect(() => {
    let running = false;
    const run = async () => {
      const current = latest.current;
      if (document.hidden || running || !(typeof current.enabled === "function" ? current.enabled() : current.enabled)) return;
      running = true;
      try {
        await current.refresh();
      } catch {
        // Загрузчики страниц показывают ошибку; следующая попытка — через минуту.
      } finally {
        running = false;
      }
    };
    const refreshPage = () => { void run(); };
    const timer = window.setInterval(refreshPage, 60000);
    window.addEventListener(PAGE_REFRESH_EVENT, refreshPage);
    document.addEventListener("visibilitychange", refreshPage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PAGE_REFRESH_EVENT, refreshPage);
      document.removeEventListener("visibilitychange", refreshPage);
    };
  }, []);
}
