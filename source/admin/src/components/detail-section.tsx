import type { ReactNode } from "react";
import { Card, Typography } from "antd";
import "./detail-section.css";

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="detail-section">
      <Card size="small" title={<Typography.Title level={3} className="detail-section__title">{title}</Typography.Title>}>
        {children}
      </Card>
    </section>
  );
}
