// Общая подготовка тестов кабинета.
import { beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// antd 5 обращается к window.matchMedia для адаптивных компонентов — в jsdom его нет.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom не рассчитывает геометрию и не предоставляет ResizeObserver.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Единый identity-мок getComputedStyle для всех тестов (раньше повторялся
// в каждом файле). Делегирует оригиналу, привязанному к window; файловые
// afterEach с vi.restoreAllMocks() снимают его, поэтому beforeEach
// восстанавливает мок перед каждым тестом.
const computed = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element: Element) => computed(element),
  );
});
