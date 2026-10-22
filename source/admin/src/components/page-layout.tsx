import { useCallback, useState, type ReactNode } from "react";
import { Typography } from "antd";
import "./page-layout.css";
import { TableSettingsContext } from "./table-settings-context";

/** Общая иерархия кабинета: заголовок → действия → фильтры → содержимое. */
export function PageLayout({ title, extra, actions, filters, children }: {
  title: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
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
        </header>
        {actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
        {(filters || tableCount > 0) && <div className="cabinet-page__filters"
          role={filters ? "search" : undefined} aria-label={filters ? "Фильтры страницы" : undefined}>
          {filters && <div className="cabinet-page__filter-fields">{filters}</div>}
          <div className="cabinet-page__table-settings" ref={setTarget} />
        </div>}
        <div className="cabinet-page__workspace">{children}</div>
      </section>
    </TableSettingsContext.Provider>
  );
}
