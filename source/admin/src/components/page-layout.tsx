import { useCallback, useState, type ReactNode } from "react";
import { useMobile } from "../lib/use-mobile";
import { Typography } from "antd";
import "./page-layout.css";
import { FilterSortSummary, PageControlsContext } from "./page-controls";
import { TableSettingsContext } from "./table-settings-context";

/** Общая иерархия кабинета: заголовок → действия → фильтры → содержимое. */
export function PageLayout({ title, extra, actions, filters, children }: {
  title: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useMobile();
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [searchTarget, setSearchTarget] = useState<HTMLDivElement | null>(null);
  const [sortTarget, setSortTarget] = useState<HTMLDivElement | null>(null);
  const [sortCount, setSortCount] = useState(0);
  const registerSort = useCallback(() => {
    setSortCount(count => count + 1);
    return () => setSortCount(count => count - 1);
  }, []);
  const [tableCount, setTableCount] = useState(0);
  const register = useCallback(() => {
    setTableCount(count => count + 1);
    return () => setTableCount(count => count - 1);
  }, []);
  return (
    <TableSettingsContext.Provider value={{ target, register }}>
    <PageControlsContext.Provider value={{ searchTarget, sortTarget, registerSort }}>
      <section className="cabinet-page">
        <header className="cabinet-page__header">
          <Typography.Title level={2} className="cabinet-page__title">{title}</Typography.Title>
          {extra && <div className="cabinet-page__view">{extra}</div>}
        </header>
        {mobile ? <>
          <div className="cabinet-page__toolbar">
            <div className="cabinet-page__search" ref={setSearchTarget} />
            {actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
          </div>
          <details className="cabinet-page__compact-filters" hidden={!filters && sortCount === 0}>
            <FilterSortSummary />
            <div className="cabinet-page__filters" role="search" aria-label="Фильтры страницы">
              {filters && <div className="cabinet-page__filter-fields">{filters}</div>}
              <div className="cabinet-page__sort" ref={setSortTarget} />
            </div>
          </details>
        </> : <>
          {actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
          {(filters || tableCount > 0) && <div className="cabinet-page__filters"
            role={filters ? "search" : undefined} aria-label={filters ? "Фильтры страницы" : undefined}>
            {filters && <div className="cabinet-page__filter-fields">{filters}</div>}
            <div className="cabinet-page__table-settings" ref={setTarget} />
          </div>}
        </>}
        <div className="cabinet-page__workspace">{children}</div>
      </section>
    </PageControlsContext.Provider>
    </TableSettingsContext.Provider>
  );
}
