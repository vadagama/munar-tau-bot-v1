import type { ReactNode } from "react";
import { Typography } from "antd";
import "./page-layout.css";

/** Общая иерархия кабинета: заголовок → действия → фильтры → содержимое. */
export function PageLayout({ title, extra, actions, filters, children }: {
  title: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cabinet-page">
      <header className="cabinet-page__header">
        <Typography.Title level={2} className="cabinet-page__title">{title}</Typography.Title>
        {extra && <div className="cabinet-page__view">{extra}</div>}
      </header>
      {actions && <div className="cabinet-page__actions" role="group" aria-label="Действия страницы">{actions}</div>}
      {filters && <div className="cabinet-page__filters" role="search" aria-label="Фильтры страницы">{filters}</div>}
      <div className="cabinet-page__workspace">{children}</div>
    </section>
  );
}
