import { useEffect, useState } from "react";

// Узкий экран — ниже AntD-брейкпоинта lg (992px): меню каркаса переходит
// в оверлей с гамбургером, контент получает компактные отступы.
const NARROW_QUERY = "(max-width: 991px)";

/** Согласовано с breakpoint="lg" прежнего Sider: телефон/узкое окно — true. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
