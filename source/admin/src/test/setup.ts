// Общая подготовка тестов кабинета.
import "@testing-library/jest-dom/vitest";

// antd 5 обращается к window.matchMedia для адаптивных компонентов — в jsdom его нет.
// Мок честно вычисляет условия min/max-width от ширины окна jsdom (по умолчанию 1024px),
// поэтому адаптивная раскладка в тестах идёт по той же ветке, что на реальном десктопе.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      const width = window.innerWidth;
      const mins = Array.from(query.matchAll(/min-width:\s*([\d.]+)px/g), m => parseFloat(m[1] ?? ""));
      const maxs = Array.from(query.matchAll(/max-width:\s*([\d.]+)px/g), m => parseFloat(m[1] ?? ""));
      const matches = (mins.length > 0 || maxs.length > 0)
        && mins.every(v => width >= v)
        && maxs.every(v => width <= v);
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
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
