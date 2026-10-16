// Общая подготовка тестов кабинета.
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
