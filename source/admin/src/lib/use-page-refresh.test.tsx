import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PAGE_REFRESH_EVENT, usePageRefresh } from "./use-page-refresh";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("обновляет раз в минуту без сброса таймера при рендере и удаляет подписки", async () => {
  vi.useFakeTimers();
  const first = vi.fn(), latest = vi.fn();
  const { rerender, unmount } = renderHook(({ refresh }) => usePageRefresh(refresh), { initialProps: { refresh: first } });
  await act(() => vi.advanceTimersByTimeAsync(30000));
  rerender({ refresh: latest });
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(60000));
  window.dispatchEvent(new Event(PAGE_REFRESH_EVENT));
  expect(latest).toHaveBeenCalledTimes(1);
});

it("не запускает параллельные запросы и пропускает скрытую вкладку", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  renderHook(() => usePageRefresh(refresh));
  await act(() => vi.advanceTimersByTimeAsync(120000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("повторный выбор меню обновляет данные, блокировка сохраняет редактируемые формы", async () => {
  const refresh = vi.fn();
  const { rerender } = renderHook(({ enabled }) => usePageRefresh(refresh, enabled), { initialProps: { enabled: false } });
  await act(async () => { window.dispatchEvent(new Event(PAGE_REFRESH_EVENT)); });
  expect(refresh).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await act(async () => { window.dispatchEvent(new Event(PAGE_REFRESH_EVENT)); });
  expect(refresh).toHaveBeenCalledTimes(1);
});
