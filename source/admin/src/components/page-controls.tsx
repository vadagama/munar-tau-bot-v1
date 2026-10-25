import { createContext, useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Input } from "antd";
import { useMobile } from "../lib/use-mobile";

export const PageControlsContext = createContext<{
  searchTarget: HTMLDivElement | null;
  sortTarget: HTMLDivElement | null;
  registerSort: () => () => void;
} | null>(null);

/** Поиск остаётся доступным, даже когда мобильные фильтры свёрнуты. */
export function PageSearch(props: ComponentProps<typeof Input.Search>) {
  const host = useContext(PageControlsContext);
  const mobile = useMobile();
  const input = <Input.Search {...props} />;
  return mobile && host ? host.searchTarget && createPortal(input, host.searchTarget) : input;
}

export function FilterSortSummary() {
  return <summary>Фильтры и сортировка</summary>;
}
