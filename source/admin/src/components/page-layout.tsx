import { useCallback, useState, type ReactNode } from "react";
import { useMobile } from "../lib/use-mobile";
import { Typography } from "antd";
import "./page-layout.css";
import { TableSettingsContext } from "./table-settings-context";

/** Общая иерархия кабинета: заголовок → действия → фильтры → содержимое. */
export function PageLayout({ title, extra, actions, filters, mobileFilters = false, children }: {
  mobileFilters?: boolean;
  title: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useMobile();
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [tableCount, setTableCount] = useState(0);
  const register = useCallback(() => {
    setTableCount(count => count + 1);
    return () => setTableCount(count => count - 1);
  }, []);
  return (
    <TableSettingsContext.Provider value={{ target, register }}>
      <section className="cabinet-page">
        <header className="cabinet-page__header">
          <Typography.Title level={2} className="cabinet-page__title">{title}</Typography.Title>
          {extra && <div className="cabinet-page__view">{extra}</div>}
          {mobile && actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
        </header>
        {!mobile && actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
        {(filters || tableCount > 0) && <div className="cabinet-page__filters"
          role={filters ? "search" : undefined} aria-label={filters ? "Фильтры страницы" : undefined}>
          {filters && (mobile && !mobileFilters
            ? <details className="cabinet-page__compact-filters"><summary>Поиск и фильтры</summary><div className="cabinet-page__filter-fields">{filters}</div></details>
            : <div className="cabinet-page__filter-fields">{filters}</div>)}
          <div className="cabinet-page__table-settings" ref={setTarget} />
        </div>}
        <div className="cabinet-page__workspace">{children}</div>
      </section>
    </TableSettingsContext.Provider>
  );
}
